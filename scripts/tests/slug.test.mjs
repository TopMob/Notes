import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  titleToSlug,
  generateUniqueSlug,
  getSlugFromPathname,
  findPageBySlugOrAlias,
  formatPageUrl,
} from '../../src/utils/slug.ts';

describe('Утилиты слагов и англофикации (Транслитерация)', () => {
  it('Корректно транслитерирует русские названия в чистые латинские слаги', () => {
    assert.equal(titleToSlug('Быстрые заметки'), 'bystrye-zametki');
    assert.equal(titleToSlug('Список покупок на вечер'), 'spisok-pokupok-na-vecher');
    assert.equal(titleToSlug('Съешь же ещё этих мягких французских булок'), 'syesh-zhe-eshchyo-etikh-myagkikh-frantsuzskikh-bulok');
    assert.equal(titleToSlug('Планы на 2026 год!'), 'plany-na-2026-god');
  });

  it('Корректно обрабатывает даты и спецсимволы', () => {
    assert.equal(titleToSlug('26.09.2026'), '26-09-2026');
    assert.equal(titleToSlug('  Заметка #1 & $100 — тест! '), 'zametka-1-100-test');
    assert.equal(titleToSlug('---'), 'note');
    assert.equal(titleToSlug(''), 'note');
  });

  it('Разрешает коллизии имен с добавлением числового индекса', () => {
    const existing = ['zametka', 'zametka-2', 'drugaya'];
    assert.equal(generateUniqueSlug('Заметка', existing), 'zametka-3');
    assert.equal(generateUniqueSlug('Новая заметка', existing), 'novaya-zametka');
    // При редактировании страницы со своим же слагом не меняет его
    assert.equal(generateUniqueSlug('Заметка', existing, 'zametka'), 'zametka');
  });

  it('Safe Collision Guard: учитывает старые алиасы других заметок при создании слага', () => {
    const activeSlugs = ['arkhiv-vstrech', 'bystrye-zametki'];
    const oldAliases = ['vstrechi']; // Заметка А ранее имела слаг vstrechi
    // Новая заметка "Встречи" не должна перехватить старый алиас заметки А
    assert.equal(generateUniqueSlug('Встречи', activeSlugs, undefined, oldAliases), 'vstrechi-2');
  });

  it('Извлекает слаг из различных путей URL', () => {
    assert.equal(getSlugFromPathname('/bystrye-zametki'), 'bystrye-zametki');
    assert.equal(getSlugFromPathname('/bystrye-zametki/'), 'bystrye-zametki');
    assert.equal(getSlugFromPathname('/p/moi-plany'), 'moi-plany');
    assert.equal(getSlugFromPathname('/page/26-09-2026'), '26-09-2026');
    assert.equal(getSlugFromPathname('/'), null);
    assert.equal(getSlugFromPathname(''), null);
  });

  it('Находит страницу по слагу, ID и старому алиасу после переименования', () => {
    const pages = [
      {
        id: 'page-1',
        title: 'Новое имя заметки',
        slug: 'novoe-imya-zametki',
        slugAliases: ['staroe-imya-zametki', 'eshche-bolee-staroe'],
      },
      {
        id: 'page-2',
        title: 'Быстрые заметки',
        slug: 'bystrye-zametki',
      },
    ];

    // По актуальному слагу
    assert.equal(findPageBySlugOrAlias(pages, 'novoe-imya-zametki')?.id, 'page-1');
    assert.equal(findPageBySlugOrAlias(pages, 'bystrye-zametki')?.id, 'page-2');

    // По старому алиасу (сохранение старых ссылок после переименования!)
    assert.equal(findPageBySlugOrAlias(pages, 'staroe-imya-zametki')?.id, 'page-1');
    assert.equal(findPageBySlugOrAlias(pages, 'eshche-bolee-staroe')?.id, 'page-1');

    // По ID
    assert.equal(findPageBySlugOrAlias(pages, 'page-1')?.id, 'page-1');

    // Несуществующая страница
    assert.equal(findPageBySlugOrAlias(pages, 'ne-sushchestvuet'), undefined);
  });

  it('Форматирует относительный путь', () => {
    assert.equal(formatPageUrl('test-slug'), '/test-slug');
  });
});
