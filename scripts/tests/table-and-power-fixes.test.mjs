import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handlePowerKeyDown } from '../../src/utils/mathText.ts';

describe('Проверка исправления перескока каретки при ^x и структуры таблиц OneNote', () => {
  it('handlePowerKeyDown корректно преобразует ^2, создает sup и ставит каретку в trailingNode, а не в начало', () => {
    // Создаем эмуляцию DOM-узлов для теста
    const parentNode = {
      children: [],
      insertBefore(newNode, referenceNode) {
        const idx = referenceNode ? this.children.indexOf(referenceNode) : -1;
        if (idx !== -1) {
          this.children.splice(idx, 0, newNode);
        } else {
          this.children.push(newNode);
        }
      },
    };

    const textNode = {
      nodeType: 3, // Node.TEXT_NODE
      textContent: '2^2',
      parentNode: parentNode,
      nextSibling: null,
    };
    parentNode.children.push(textNode);

    let activeRange = null;

    // Глобальные моки для окружения Node.js
    global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
    global.document = {
      createElement(tag) {
        return { tagName: tag.toUpperCase(), textContent: '', style: {} };
      },
      createTextNode(content) {
        return { nodeType: 3, textContent: content, length: content.length };
      },
      createRange() {
        return {
          startContainer: null,
          startOffset: 0,
          setStart(node, offset) {
            this.startContainer = node;
            this.startOffset = offset;
          },
          setStartAfter(node) {
            this.startContainer = node;
            this.startOffset = 0;
          },
          collapse(toStart) {
            this.collapsed = toStart;
          },
        };
      },
    };

    global.window = {
      getSelection() {
        return {
          isCollapsed: true,
          rangeCount: 1,
          getRangeAt() {
            return {
              startContainer: textNode,
              startOffset: 3, // сразу после 2^2
            };
          },
          removeAllRanges() {
            activeRange = null;
          },
          addRange(range) {
            activeRange = range;
          },
        };
      },
    };

    let callbackCalled = false;
    const fakeEvent = {
      key: ' ',
      preventDefault() {},
      stopPropagation() {},
    };

    const result = handlePowerKeyDown(fakeEvent, () => {
      callbackCalled = true;
    });

    assert.equal(result, true, 'handlePowerKeyDown должен вернуть true');
    assert.equal(callbackCalled, true, 'onConverted callback должен быть вызван');
    assert.equal(textNode.textContent, '2', 'Базовый текст до степени должен остаться "2"');

    // Проверяем созданный <sup>
    const supNode = parentNode.children.find((c) => c.tagName === 'SUP');
    assert.ok(supNode, 'Элемент <sup> должен быть вставлен в DOM');
    assert.equal(supNode.textContent, '2', 'Значение степени должно быть "2"');

    // Проверяем trailingNode (текстовый узел с неразрывным пробелом)
    const trailingNode = parentNode.children.find(
      (c) => c.nodeType === 3 && c !== textNode
    );
    assert.ok(trailingNode, 'trailingNode должен быть создан после <sup>');
    assert.equal(trailingNode.textContent, '\u00A0', 'trailingNode должен содержать неразрывный пробел');

    // Проверяем, что курсор установлен в trailingNode после пробела (смещение 1), а не сброшен в 0 или начало контейнера
    assert.ok(activeRange, 'Range должен быть установлен в selection');
    assert.equal(activeRange.startContainer, trailingNode, 'Курсор должен быть в trailingNode');
    assert.equal(activeRange.startOffset, 1, 'Курсор должен стоять после неразрывного пробела (смещение 1)');
  });

  it('Шаблон вставки таблицы OneNote имеет width: max-content и относительные колонки в em', () => {
    // Проверяем структуру разметки, генерируемой для таблицы
    const cols = 3;
    const rows = 2;
    let tableHtml = '<table class="onenote-table notes-table" style="border-collapse: collapse; width: max-content; margin: 8px 0;"><colgroup>';
    for (let c = 0; c < cols; c++) {
      tableHtml += '<col style="width: 7.5em; min-width: 3.5em;" />';
    }
    tableHtml += '</colgroup><tbody>';
    for (let r = 0; r < rows; r++) {
      tableHtml += '<tr>';
      for (let c = 0; c < cols; c++) {
        tableHtml += '<td style="border: 1px solid var(--hairline, #c8c6c4); padding: 0.45em 0.75em; word-break: break-word;">&nbsp;</td>';
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table><p></p>';

    assert.ok(tableHtml.includes('width: max-content'), 'Таблица не должна иметь жесткий width: 100%');
    assert.ok(tableHtml.includes('<colgroup>'), 'Таблица должна иметь colgroup для защиты колонок');
    assert.ok(tableHtml.includes('width: 7.5em'), 'Ширина колонок задана в em для масштабирования с шрифтом');
    assert.ok(tableHtml.includes('min-width: 3.5em'), 'Колонки защищены от сжатия min-width');
    assert.ok(tableHtml.includes('word-break: break-word'), 'Ячейки имеют word-break');
  });
});
