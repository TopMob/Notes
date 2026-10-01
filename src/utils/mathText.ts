export interface SymbolItem {
  char: string;
  name: string;
  category: 'popular' | 'greek' | 'math' | 'relations' | 'arrows' | 'powers';
  keywords: string[];
}

export const POPULAR_SYMBOLS: string[] = [
  'α', 'β', 'γ', 'ω', 'Ω', '√', 'π', '∞',
  '±', '×', '÷', '≠', '≈', '≤', '≥', '°',
  '²', '³', '→', '∫', '∑', '∆', '∈', '∅'
];

export const ALL_SYMBOLS: SymbolItem[] = [
  // 1. Греческие буквы (строчные)
  { char: 'α', name: 'Альфа (строчная)', category: 'greek', keywords: ['альфа', 'alpha', 'a'] },
  { char: 'β', name: 'Бета (строчная)', category: 'greek', keywords: ['бета', 'бетта', 'beta', 'b'] },
  { char: 'γ', name: 'Гамма (строчная)', category: 'greek', keywords: ['гамма', 'gamma', 'g'] },
  { char: 'δ', name: 'Дельта (строчная)', category: 'greek', keywords: ['дельта', 'delta', 'd'] },
  { char: 'ε', name: 'Эпсилон (строчная)', category: 'greek', keywords: ['эпсилон', 'epsilon', 'e'] },
  { char: 'ζ', name: 'Дзета (строчная)', category: 'greek', keywords: ['дзета', 'zeta', 'z'] },
  { char: 'η', name: 'Эта (строчная)', category: 'greek', keywords: ['эта', 'eta', 'h'] },
  { char: 'θ', name: 'Тета (строчная)', category: 'greek', keywords: ['тета', 'theta', 'th'] },
  { char: 'ι', name: 'Йота (строчная)', category: 'greek', keywords: ['йота', 'iota', 'i'] },
  { char: 'κ', name: 'Каппа (строчная)', category: 'greek', keywords: ['каппа', 'kappa', 'k'] },
  { char: 'λ', name: 'Лямбда (строчная)', category: 'greek', keywords: ['лямбда', 'lambda', 'l'] },
  { char: 'μ', name: 'Мю / микро (строчная)', category: 'greek', keywords: ['мю', 'микро', 'mu', 'micro', 'm'] },
  { char: 'ν', name: 'Ню (строчная)', category: 'greek', keywords: ['ню', 'nu', 'n'] },
  { char: 'ξ', name: 'Кси (строчная)', category: 'greek', keywords: ['кси', 'xi', 'x'] },
  { char: 'ο', name: 'Омикрон (строчная)', category: 'greek', keywords: ['омикрон', 'omicron', 'o'] },
  { char: 'π', name: 'Пи (строчная)', category: 'greek', keywords: ['пи', 'pi', 'p'] },
  { char: 'ρ', name: 'Ро (строчная)', category: 'greek', keywords: ['ро', 'rho', 'r'] },
  { char: 'σ', name: 'Сигма (строчная)', category: 'greek', keywords: ['сигма', 'sigma', 's'] },
  { char: 'τ', name: 'Тау (строчная)', category: 'greek', keywords: ['тау', 'tau', 't'] },
  { char: 'υ', name: 'Ипсилон (строчная)', category: 'greek', keywords: ['ипсилон', 'upsilon', 'u'] },
  { char: 'φ', name: 'Фи (строчная)', category: 'greek', keywords: ['фи', 'phi', 'ph', 'f'] },
  { char: 'χ', name: 'Хи (строчная)', category: 'greek', keywords: ['хи', 'chi', 'ch'] },
  { char: 'ψ', name: 'Пси (строчная)', category: 'greek', keywords: ['пси', 'psi', 'ps'] },
  { char: 'ω', name: 'Омега (строчная)', category: 'greek', keywords: ['омега', 'omega', 'w'] },

  // Греческие буквы (прописные / заглавные)
  { char: 'Α', name: 'Альфа (заглавная)', category: 'greek', keywords: ['альфа', 'alpha', 'заглавная'] },
  { char: 'Β', name: 'Бета (заглавная)', category: 'greek', keywords: ['бета', 'бетта', 'beta', 'заглавная'] },
  { char: 'Γ', name: 'Гамма (заглавная)', category: 'greek', keywords: ['гамма', 'gamma', 'заглавная'] },
  { char: 'Δ', name: 'Дельта (заглавная / дискриминант)', category: 'greek', keywords: ['дельта', 'дискриминант', 'delta', 'заглавная'] },
  { char: 'Ε', name: 'Эпсилон (заглавная)', category: 'greek', keywords: ['эпсилон', 'epsilon', 'заглавная'] },
  { char: 'Ζ', name: 'Дзета (заглавная)', category: 'greek', keywords: ['дзета', 'zeta', 'заглавная'] },
  { char: 'Η', name: 'Эта (заглавная)', category: 'greek', keywords: ['эта', 'eta', 'заглавная'] },
  { char: 'Θ', name: 'Тета (заглавная)', category: 'greek', keywords: ['тета', 'theta', 'заглавная'] },
  { char: 'Λ', name: 'Лямбда (заглавная)', category: 'greek', keywords: ['лямбда', 'lambda', 'заглавная'] },
  { char: 'Ξ', name: 'Кси (заглавная)', category: 'greek', keywords: ['кси', 'xi', 'заглавная'] },
  { char: 'Π', name: 'Пи (заглавная / произведение)', category: 'greek', keywords: ['пи', 'произведение', 'pi', 'заглавная'] },
  { char: 'Σ', name: 'Сигма (заглавная / сумма)', category: 'greek', keywords: ['сигма', 'сумма', 'sigma', 'заглавная'] },
  { char: 'Φ', name: 'Фи (заглавная)', category: 'greek', keywords: ['фи', 'phi', 'заглавная'] },
  { char: 'Ψ', name: 'Пси (заглавная)', category: 'greek', keywords: ['пси', 'psi', 'заглавная'] },
  { char: 'Ω', name: 'Омега (заглавная / Ом)', category: 'greek', keywords: ['омега', 'omega', 'ом', 'сопротивление', 'заглавная'] },

  // 2. Математические символы и корни
  { char: '√', name: 'Квадратный корень', category: 'math', keywords: ['корень', 'квадратный', 'корень квадратный', 'sqrt', 'root', 'радикал'] },
  { char: '∛', name: 'Кубический корень', category: 'math', keywords: ['корень', 'кубический', 'cbrt', '3'] },
  { char: '∜', name: 'Корень 4-й степени', category: 'math', keywords: ['корень', 'четвертой степени', '4'] },
  { char: '±', name: 'Плюс-минус', category: 'math', keywords: ['плюс', 'минус', 'плюс-минус', 'plusminus', 'pm'] },
  { char: '∓', name: 'Минус-плюс', category: 'math', keywords: ['минус', 'плюс', 'минус-плюс', 'mp'] },
  { char: '×', name: 'Знак умножения (крестик)', category: 'math', keywords: ['умножение', 'умножить', 'крестик', 'times', 'mult'] },
  { char: '·', name: 'Точка умножения (интерпункт)', category: 'math', keywords: ['умножение', 'точка', 'cdot', 'dot'] },
  { char: '÷', name: 'Знак деления', category: 'math', keywords: ['деление', 'разделить', 'divide', 'div'] },
  { char: '⁄', name: 'Дробная черта', category: 'math', keywords: ['дробь', 'деление', 'frac', 'slash'] },
  { char: '∞', name: 'Бесконечность', category: 'math', keywords: ['бесконечность', 'infinity', 'inf'] },
  { char: '∫', name: 'Интеграл', category: 'math', keywords: ['интеграл', 'integral', 'int'] },
  { char: '∬', name: 'Двойной интеграл', category: 'math', keywords: ['двойной интеграл', 'iint'] },
  { char: '∮', name: 'Контурный интеграл', category: 'math', keywords: ['контурный интеграл', 'oint'] },
  { char: '∑', name: 'Знак суммы', category: 'math', keywords: ['сумма', 'суммирование', 'sum'] },
  { char: '∏', name: 'Знак произведения', category: 'math', keywords: ['произведение', 'prod'] },
  { char: '∂', name: 'Частная производная', category: 'math', keywords: ['частная производная', 'дифференциал', 'partial', 'd'] },
  { char: '∇', name: 'Набла (градиент)', category: 'math', keywords: ['набла', 'градиент', 'nabla', 'grad'] },
  { char: '∆', name: 'Дельта (приращение / Лапласиан)', category: 'math', keywords: ['дельта', 'приращение', 'разность', 'laplace'] },
  { char: '°', name: 'Градус', category: 'math', keywords: ['градус', 'degree', 'deg', 'угол', 'температура'] },
  { char: '′', name: 'Штрих (минута / производная)', category: 'math', keywords: ['штрих', 'производная', 'минута', 'prime'] },
  { char: '″', name: 'Двойной штрих (секунда)', category: 'math', keywords: ['двойной штрих', 'секунда', 'prime2'] },
  { char: '%', name: 'Процент', category: 'math', keywords: ['процент', 'percent'] },
  { char: '‰', name: 'Промилле', category: 'math', keywords: ['промилле', 'permil'] },

  // 3. Отношения, логика и множества
  { char: '≠', name: 'Не равно', category: 'relations', keywords: ['не равно', 'neq', 'not equal'] },
  { char: '≈', name: 'Приблизительно равно', category: 'relations', keywords: ['приблизительно', 'примерно', 'approx'] },
  { char: '≡', name: 'Тождественно равно', category: 'relations', keywords: ['тождественно', 'эквивалентно', 'equiv'] },
  { char: '≤', name: 'Меньше или равно', category: 'relations', keywords: ['меньше или равно', 'leq', 'le'] },
  { char: '≥', name: 'Больше или равно', category: 'relations', keywords: ['больше или равно', 'geq', 'ge'] },
  { char: '≪', name: 'Намного меньше', category: 'relations', keywords: ['намного меньше', 'll'] },
  { char: '≫', name: 'Намного больше', category: 'relations', keywords: ['намного больше', 'gg'] },
  { char: '∝', name: 'Пропорционально', category: 'relations', keywords: ['пропорционально', 'prop'] },
  { char: '∈', name: 'Принадлежит (элемент множества)', category: 'relations', keywords: ['принадлежит', 'элемент', 'входит', 'in'] },
  { char: '∉', name: 'Не принадлежит', category: 'relations', keywords: ['не принадлежит', 'не входит', 'notin'] },
  { char: '⊂', name: 'Строгое подмножество', category: 'relations', keywords: ['подмножество', 'включение', 'subset'] },
  { char: '⊆', name: 'Подмножество или равно', category: 'relations', keywords: ['подмножество', 'subseteq'] },
  { char: '∪', name: 'Объединение множеств', category: 'relations', keywords: ['объединение', 'чашка', 'union'] },
  { char: '∩', name: 'Пересечение множеств', category: 'relations', keywords: ['пересечение', 'шапка', 'intersect'] },
  { char: '∅', name: 'Пустое множество', category: 'relations', keywords: ['пустое множество', 'empty'] },
  { char: '∀', name: 'Квантор всеобщности (для любого)', category: 'relations', keywords: ['для любого', 'для всех', 'квантор', 'forall'] },
  { char: '∃', name: 'Квантор существования (существует)', category: 'relations', keywords: ['существует', 'найдется', 'квантор', 'exists'] },
  { char: '∄', name: 'Не существует', category: 'relations', keywords: ['не существует', 'nexists'] },
  { char: '⊥', name: 'Перпендикулярно', category: 'relations', keywords: ['перпендикуляр', 'перпендикулярно', 'perp'] },
  { char: '∥', name: 'Параллельно', category: 'relations', keywords: ['параллельно', 'parallel'] },
  { char: '∠', name: 'Угол', category: 'relations', keywords: ['угол', 'angle'] },

  // 4. Стрелки
  { char: '→', name: 'Стрелка вправо', category: 'arrows', keywords: ['стрелка', 'вправо', 'следует', 'right', 'to'] },
  { char: '←', name: 'Стрелка влево', category: 'arrows', keywords: ['стрелка', 'влево', 'left'] },
  { char: '↔', name: 'Двусторонняя стрелка', category: 'arrows', keywords: ['двусторонняя стрелка', 'leftright'] },
  { char: '↑', name: 'Стрелка вверх', category: 'arrows', keywords: ['стрелка', 'вверх', 'up'] },
  { char: '↓', name: 'Стрелка вниз', category: 'arrows', keywords: ['стрелка', 'вниз', 'down'] },
  { char: '⇒', name: 'Следование (импликация)', category: 'arrows', keywords: ['следовательно', 'импликация', 'implies', 'влечет'] },
  { char: '⇐', name: 'Обратная импликация', category: 'arrows', keywords: ['обратно', 'следует'] },
  { char: '⇔', name: 'Эквивалентность', category: 'arrows', keywords: ['эквивалентно', 'тогда и только тогда', 'iff'] },
  { char: '↦', name: 'Отображение (переходит в)', category: 'arrows', keywords: ['отображение', 'переходит', 'mapsto'] },

  // 5. Степени и индексы (быстрый ввод)
  { char: '⁰', name: 'Степень 0', category: 'powers', keywords: ['степень', '0', 'нуль'] },
  { char: '¹', name: 'Степень 1', category: 'powers', keywords: ['степень', '1', 'один'] },
  { char: '²', name: 'Степень 2 (квадрат)', category: 'powers', keywords: ['степень', '2', 'квадрат'] },
  { char: '³', name: 'Степень 3 (куб)', category: 'powers', keywords: ['степень', '3', 'куб'] },
  { char: '⁴', name: 'Степень 4', category: 'powers', keywords: ['степень', '4'] },
  { char: '⁵', name: 'Степень 5', category: 'powers', keywords: ['степень', '5'] },
  { char: '⁶', name: 'Степень 6', category: 'powers', keywords: ['степень', '6'] },
  { char: '⁷', name: 'Степень 7', category: 'powers', keywords: ['степень', '7'] },
  { char: '⁸', name: 'Степень 8', category: 'powers', keywords: ['степень', '8'] },
  { char: '⁹', name: 'Степень 9', category: 'powers', keywords: ['степень', '9'] },
  { char: '⁺', name: 'Степень плюс', category: 'powers', keywords: ['степень', 'плюс'] },
  { char: '⁻', name: 'Степень минус', category: 'powers', keywords: ['степень', 'минус'] },
  { char: 'ⁿ', name: 'Степень n', category: 'powers', keywords: ['степень', 'n'] },
  { char: '₀', name: 'Индекс 0', category: 'powers', keywords: ['индекс', '0'] },
  { char: '₁', name: 'Индекс 1', category: 'powers', keywords: ['индекс', '1'] },
  { char: '₂', name: 'Индекс 2', category: 'powers', keywords: ['индекс', '2'] },
  { char: '₃', name: 'Индекс 3', category: 'powers', keywords: ['индекс', '3'] },
  { char: '₄', name: 'Индекс 4', category: 'powers', keywords: ['индекс', '4'] },
  { char: '₅', name: 'Индекс 5', category: 'powers', keywords: ['индекс', '5'] },
];

/**
 * Регулярное выражение для токенизации HTML:
 * Защищает:
 * 1) KaTeX span и div блоки
 * 2) Существующие теги sup и sub
 * 3) Блоки code и pre
 * 4) Любые HTML теги <...>
 */
const HTML_TOKEN_REGEX = /(<span[^>]*class="[^"]*katex[^"]*"[^>]*>[\s\S]*?<\/span>|<div[^>]*class="[^"]*katex[^"]*"[^>]*>[\s\S]*?<\/div>|<sup\b[^>]*>[\s\S]*?<\/sup>|<sub\b[^>]*>[\s\S]*?<\/sub>|<code\b[^>]*>[\s\S]*?<\/code>|<pre\b[^>]*>[\s\S]*?<\/pre>|<[^>]+>)|([^<]+)/gi;

/**
 * Паттерн для поиска степени в обычном тексте:
 * - ^(...) со скобками
 * - ^{...} с фигурными скобками
 * - ^-?\\d+(?:\\.\\d+)? число с возможным минусом или дробью
 * - ^[a-zA-Z\u0370-\u03FF\u1F00-\u1FFF\d]+ буквы/греческие буквы/цифры
 */
const POWER_IN_TEXT_REGEX = /\^(\(([^<>()\r\n]+)\)|\{([^<>{}\r\n]+)\}|(-?\d+(?:\.\d+)?)|([a-zA-Z\u0370-\u03FF\u1F00-\u1FFF\d]+))/g;

/**
 * Преобразует выражения со степенью (например, 2^2, 10^-3, x^2, (a+b)^(2), 2^{10})
 * в стандартный HTML вид с тегом <sup> (например, 2<sup>2</sup>), не затрагивая HTML теги и KaTeX.
 */
export function convertPowersToSuperscript(html: string): string {
  if (!html || !html.includes('^')) return html;

  return html.replace(HTML_TOKEN_REGEX, (_match: string, tagOrProtected?: string, text?: string) => {
    if (tagOrProtected) {
      return tagOrProtected;
    }
    if (!text || !text.includes('^')) {
      return text || '';
    }
    return text.replace(
      POWER_IN_TEXT_REGEX,
      (
        _pMatch: string,
        _fullInner: string,
        parenInner?: string,
        braceInner?: string,
        numInner?: string,
        wordInner?: string
      ) => {
        const val = parenInner || braceInner || numInner || wordInner || _fullInner;
        return `<sup>${val}</sup>`;
      }
    );
  });
}

/**
 * Обрабатывает клавиатурный ввод в contentEditable:
 * При нажатии пробела, Enter или математических операторов (+, -, *, /, =, ), ], ;, ,)
 * проверяет, не предшествует ли курсору выражение степени ^x, и мгновенно конвертирует его в <sup>x</sup>.
 */
export function handlePowerKeyDown(
  e: React.KeyboardEvent<HTMLDivElement>,
  onConverted?: () => void
): boolean {
  const triggerKeys = [' ', 'Spacebar', 'Enter', '+', '-', '*', '/', '=', ')', ']', ';', ','];
  if (!triggerKeys.includes(e.key)) return false;

  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return false;

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return false;

  const text = node.textContent || '';
  const caretOffset = range.startOffset;
  const textBefore = text.slice(0, caretOffset);

  // Ищем степень прямо перед курсором
  const match = textBefore.match(
    /\^(\(([^<>()\r\n]+)\)|\{([^<>{}\r\n]+)\}|(-?\d+(?:\.\d+)?)|([a-zA-Z\u0370-\u03FF\u1F00-\u1FFF\d]+))$/
  );
  if (!match) return false;

  const matchedString = match[0];
  const powerVal = match[2] || match[3] || match[4] || match[5] || match[1];
  const matchStartIndex = caretOffset - matchedString.length;

  const parent = node.parentNode;
  if (!parent) return false;

  e.preventDefault();
  e.stopPropagation();

  const beforeText = text.slice(0, matchStartIndex);
  const afterText = text.slice(caretOffset);

  node.textContent = beforeText;

  const sup = document.createElement('sup');
  sup.textContent = powerVal;

  let trailingChar = '';
  if (e.key === ' ' || e.key === 'Spacebar') {
    trailingChar = '\u00A0';
  } else if (e.key !== 'Enter') {
    trailingChar = e.key;
  }

  const trailingNode = document.createTextNode(trailingChar + afterText);

  parent.insertBefore(sup, node.nextSibling);
  parent.insertBefore(trailingNode, sup.nextSibling);

  if (e.key === 'Enter') {
    const br = document.createElement('br');
    parent.insertBefore(br, sup.nextSibling);
    const newRange = document.createRange();
    newRange.setStartAfter(br);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  } else {
    const newRange = document.createRange();
    newRange.setStart(trailingNode, trailingChar.length);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }

  if (onConverted) {
    onConverted();
  }
  return true;
}
