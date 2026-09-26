/**
 * slug.ts
 * Утилиты для англофикации (транслитерации) названий заметок,
 * формирования красивых URL и разрешения слагов/алиасов.
 */

// Таблица транслитерации кириллицы в латиницу (ГОСТ 7.79-2000 / международный стандарт)
const CYRILLIC_TO_LATIN_MAP: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  // Дополнительные символы (украинский, белорусский и частые спецсимволы)
  є: 'ye',
  і: 'i',
  ї: 'yi',
  ґ: 'g',
  ў: 'u',
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
};

/**
 * Преобразует любую строку (включая русские символы) в безопасный URL-слаг
 * Пример: "Быстрые заметки" -> "bystrye-zametki"
 * Пример: "26.09.2026" -> "26-09-2026"
 * Пример: "Список дел & планы!" -> "spisok-del-plany"
 */
export function titleToSlug(title: string): string {
  if (!title || typeof title !== 'string') {
    return 'note';
  }

  const normalized = title.trim().toLowerCase();
  if (!normalized) {
    return 'note';
  }

  // 1. Посимвольная транслитерация кириллицы с учетом разделительных ъ/ь перед гласными
  let result = '';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const prevChar = i > 0 ? normalized[i - 1] : '';

    // Разделительный ъ/ь перед 'е' -> 'ye' (например: "съешь" -> "syesh", "подъезд" -> "podyezd")
    if (char === 'е' && (prevChar === 'ъ' || prevChar === 'ь')) {
      result += 'ye';
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(CYRILLIC_TO_LATIN_MAP, char)) {
      result += CYRILLIC_TO_LATIN_MAP[char];
    } else {
      result += char;
    }
  }

  // 2. Очистка: заменяем любые нелатинские буквы/цифры на дефис
  result = result
    .replace(/[^a-z0-9]+/g, '-') // Все знаки препинания, пробелы, символы -> '-'
    .replace(/^-+|-+$/g, '') // Убираем дефисы в начале и конце
    .replace(/--+/g, '-'); // Схлопываем повторяющиеся дефисы

  return result || 'note';
}

/**
 * Генерирует уникальный слаг с учетом уже существующих заметок.
 * Если слаг уже занят другой заметкой, добавляет суффикс (-2, -3 и т.д.).
 */
export function generateUniqueSlug(
  title: string,
  existingSlugs: string[],
  currentSlug?: string,
  existingAliases: string[] = []
): string {
  const baseSlug = titleToSlug(title);

  // Если текущий слаг уже совпадает с базовым (при редактировании заметки)
  if (currentSlug && currentSlug === baseSlug) {
    return currentSlug;
  }

  // Safe Collision Guard: объединяем занятые актуальные слаги и существующие алиасы
  const occupied = new Set([
    ...existingSlugs.filter((s) => s && s !== currentSlug),
    ...existingAliases.filter((a) => a && a !== currentSlug),
  ]);

  if (!occupied.has(baseSlug)) {
    return baseSlug;
  }

  let index = 2;
  while (occupied.has(`${baseSlug}-${index}`)) {
    index++;
  }

  return `${baseSlug}-${index}`;
}

/**
 * Извлекает слаг из текущего пути URL (window.location.pathname)
 * Поддерживает:
 * - "/bystrye-zametki" -> "bystrye-zametki"
 * - "/bystrye-zametki/" -> "bystrye-zametki"
 * - "/p/bystrye-zametki" -> "bystrye-zametki"
 * - "/" -> null
 */
export function getSlugFromPathname(pathname: string): string | null {
  if (!pathname || pathname === '/') return null;

  try {
    const decoded = decodeURIComponent(pathname);
    const cleaned = decoded.replace(/^\/+|\/+$/g, '');
    if (!cleaned) return null;

    // Если путь с префиксом /p/ или /page/
    if (cleaned.startsWith('p/')) {
      return cleaned.slice(2).trim() || null;
    }
    if (cleaned.startsWith('page/')) {
      return cleaned.slice(5).trim() || null;
    }

    return cleaned.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Формирует абсолютный или относительный URL для страницы по слагу
 */
export function formatPageUrl(slug: string, absolute = false): string {
  const path = `/${slug}`;
  if (!absolute || typeof window === 'undefined') {
    return path;
  }
  return `${window.location.origin}${path}`;
}

export interface SlugIdentifiable {
  id: string;
  title: string;
  slug?: string;
  slugAliases?: string[];
}

/**
 * Ищет страницу среди списка по слагу, старому алиасу (редирект), названию или прямому ID
 */
export function findPageBySlugOrAlias<T extends SlugIdentifiable>(
  pages: T[],
  query: string
): T | undefined {
  if (!query || !pages.length) return undefined;

  const target = query.trim().toLowerCase();

  // 1. Точное совпадение по актуальному slug
  const directMatch = pages.find((p) => (p.slug || titleToSlug(p.title)).toLowerCase() === target);
  if (directMatch) return directMatch;

  // 2. Совпадение по истории старых слагов (slugAliases) для сохранения ссылок после переименования
  const aliasMatch = pages.find(
    (p) =>
      Array.isArray(p.slugAliases) &&
      p.slugAliases.some((alias) => alias.toLowerCase() === target)
  );
  if (aliasMatch) return aliasMatch;

  // 3. Совпадение по прямому ID (например, page-1710000000)
  const idMatch = pages.find((p) => p.id.toLowerCase() === target);
  if (idMatch) return idMatch;

  // 4. Fallback: совпадение по транслитерированному заголовку
  const titleSlugMatch = pages.find((p) => titleToSlug(p.title) === target);
  if (titleSlugMatch) return titleSlugMatch;

  return undefined;
}
