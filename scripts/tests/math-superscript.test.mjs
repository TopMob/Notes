import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  convertPowersToSuperscript,
  ALL_SYMBOLS,
  POPULAR_SYMBOLS,
} from '../../src/utils/mathText.ts';

describe('Конвертация степеней ^x и база символов (Задачи 1 и 2)', () => {
  it('Корректно переводит 2^2 в 2<sup>2</sup>', () => {
    assert.equal(convertPowersToSuperscript('2^2'), '2<sup>2</sup>');
  });

  it('Корректно переводит степени с отрицательными числами и десятичными дробями', () => {
    assert.equal(convertPowersToSuperscript('10^-3'), '10<sup>-3</sup>');
    assert.equal(convertPowersToSuperscript('2^0.5'), '2<sup>0.5</sup>');
    assert.equal(convertPowersToSuperscript('2^10'), '2<sup>10</sup>');
  });

  it('Корректно переводит несколько степеней в одном выражении', () => {
    assert.equal(
      convertPowersToSuperscript('x^2 + y^2 = z^2'),
      'x<sup>2</sup> + y<sup>2</sup> = z<sup>2</sup>'
    );
  });

  it('Корректно обрабатывает степени в скобках: (a+b)^(2) и 2^{10}', () => {
    assert.equal(convertPowersToSuperscript('(a+b)^(2)'), '(a+b)<sup>2</sup>');
    assert.equal(convertPowersToSuperscript('2^{10}'), '2<sup>10</sup>');
    assert.equal(convertPowersToSuperscript('x^(n+1)'), 'x<sup>n+1</sup>');
  });

  it('Корректно обрабатывает переменные и греческие буквы в степенях: e^x, 2^α', () => {
    assert.equal(convertPowersToSuperscript('e^x'), 'e<sup>x</sup>');
    assert.equal(convertPowersToSuperscript('2^α'), '2<sup>α</sup>');
  });

  it('Не ломает HTML-теги и стили при конвертации', () => {
    assert.equal(
      convertPowersToSuperscript('<p style="color: red;">2^2</p>'),
      '<p style="color: red;">2<sup>2</sup></p>'
    );
    assert.equal(
      convertPowersToSuperscript('<img src="test.png" alt="2^2" />'),
      '<img src="test.png" alt="2^2" />'
    );
  });

  it('Не изменяет KaTeX блоки формул', () => {
    const katexSnippet = '<span class="katex-rendered-block" data-latex="2^2">$2^2$</span>';
    assert.equal(convertPowersToSuperscript(katexSnippet), katexSnippet);
  });

  it('Не затрагивает уже существующие теги <sup> и <sub>', () => {
    assert.equal(convertPowersToSuperscript('2<sup>2</sup>'), '2<sup>2</sup>');
    assert.equal(convertPowersToSuperscript('H<sub>2</sub>O'), 'H<sub>2</sub>O');
  });

  it('База символов содержит альфа, омега, бета, квадратный корень и другие', () => {
    const chars = ALL_SYMBOLS.map((s) => s.char);
    assert.ok(chars.includes('α'), 'Должен содержать альфа');
    assert.ok(chars.includes('ω'), 'Должен содержать омега');
    assert.ok(chars.includes('Ω'), 'Должен содержать прописную омегу');
    assert.ok(chars.includes('β'), 'Должен содержать бета');
    assert.ok(chars.includes('√'), 'Должен содержать квадратный корень');
    assert.ok(chars.includes('∛'), 'Должен содержать кубический корень');
    assert.ok(chars.includes('∞'), 'Должен содержать бесконечность');
    assert.ok(chars.includes('±'), 'Должен содержать плюс-минус');
    assert.ok(chars.includes('≠'), 'Должен содержать не равно');
    assert.ok(chars.includes('≤'), 'Должен содержать меньше или равно');
    assert.ok(chars.includes('≥'), 'Должен содержать больше или равно');

    // Проверяем популярные символы
    assert.ok(POPULAR_SYMBOLS.includes('α'));
    assert.ok(POPULAR_SYMBOLS.includes('ω'));
    assert.ok(POPULAR_SYMBOLS.includes('√'));
  });
});
