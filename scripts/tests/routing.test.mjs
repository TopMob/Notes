import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateUniqueSlug,
  titleToSlug,
  findPageBySlugOrAlias,
  getSlugFromPathname,
} from '../../src/utils/slug.ts';

describe('Маршрутизация и Deep Linking (Этап 2)', () => {
  it('Автоматически разрешает слаг для существующих страниц без поля slug (обратная совместимость)', () => {
    const legacyPage = {
      id: 'page-legacy-1',
      title: 'Быстрые заметки',
      // slug отсутствует в базе
    };

    const pages = [legacyPage];
    const resolved = findPageBySlugOrAlias(pages, 'bystrye-zametki');
    assert.equal(resolved?.id, 'page-legacy-1');
  });

  it('Safe Collision Guard защищает старые ссылки при создании новых заметок с таким же именем', () => {
    // Страница 1 переименована, её старый слаг "plany" ушёл в алиасы
    const page1 = {
      id: 'page-1',
      title: 'Планы на будущее',
      slug: 'plany-na-budushchee',
      slugAliases: ['plany'],
    };

    const activeSlugs = [page1.slug];
    const allAliases = page1.slugAliases;

    // Пользователь создает новую заметку с именем "Планы"
    const newSlug = generateUniqueSlug('Планы', activeSlugs, undefined, allAliases);

    // Новая заметка должна получить plany-2, не перехватывая старую ссылку
    assert.equal(newSlug, 'plany-2');

    const page2 = {
      id: 'page-2',
      title: 'Планы',
      slug: newSlug,
      slugAliases: [],
    };

    const allPages = [page1, page2];

    // Старая ссылка /plany открывает page-1!
    assert.equal(findPageBySlugOrAlias(allPages, 'plany')?.id, 'page-1');
    // Ссылка /plany-2 открывает page-2!
    assert.equal(findPageBySlugOrAlias(allPages, 'plany-2')?.id, 'page-2');
  });

  it('Актуальный слаг имеет приоритет над старым алиасом, если они совпадают', () => {
    const pageOld = {
      id: 'page-old',
      title: 'Старый документ',
      slug: 'staryy-dokument',
      slugAliases: ['vstrecha'],
    };

    const pageNew = {
      id: 'page-new',
      title: 'Встреча',
      slug: 'vstrecha', // Прямой актуальный слаг
      slugAliases: [],
    };

    const allPages = [pageOld, pageNew];

    // Приоритет №1: точное совпадение по актуальному слагу
    assert.equal(findPageBySlugOrAlias(allPages, 'vstrecha')?.id, 'page-new');
  });

  it('Корректно извлекает слаг из путей браузера', () => {
    assert.equal(getSlugFromPathname('/bystrye-zametki'), 'bystrye-zametki');
    assert.equal(getSlugFromPathname('/26-09-2026/'), '26-09-2026');
    assert.equal(getSlugFromPathname('/'), null);
  });
});
