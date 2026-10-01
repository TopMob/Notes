import React, { useState, useMemo, useEffect } from 'react';
import { Search, X, Sparkles } from 'lucide-react';
import { RibbonDropdown } from './RibbonDropdown';
import { ALL_SYMBOLS, POPULAR_SYMBOLS, SymbolItem } from '../../utils/mathText';

interface SymbolPickerDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  onInsertSymbol: (symbol: string) => void;
}

const CATEGORIES: { id: SymbolItem['category'] | 'popular'; label: string }[] = [
  { id: 'popular', label: 'Популярные' },
  { id: 'greek', label: 'Греческие' },
  { id: 'math', label: 'Математика и корни' },
  { id: 'relations', label: 'Отношения' },
  { id: 'arrows', label: 'Стрелки' },
  { id: 'powers', label: 'Степени' },
];

const STORAGE_KEY = 'onenote_recent_symbols';

export const SymbolPickerDropdown: React.FC<SymbolPickerDropdownProps> = ({
  isOpen,
  onClose,
  anchorRef,
  onInsertSymbol,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<SymbolItem['category'] | 'popular'>('popular');
  const [hoveredSymbol, setHoveredSymbol] = useState<SymbolItem | null>(null);
  const [recentSymbols, setRecentSymbols] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : POPULAR_SYMBOLS.slice(0, 10);
    } catch {
      return POPULAR_SYMBOLS.slice(0, 10);
    }
  });
  const [justInserted, setJustInserted] = useState<string | null>(null);

  // Сброс поиска при закрытии/открытии
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setHoveredSymbol(null);
    }
  }, [isOpen]);

  const handleSelectSymbol = (char: string) => {
    onInsertSymbol(char);

    // Добавляем в недавние
    setRecentSymbols((prev) => {
      const updated = [char, ...prev.filter((c) => c !== char)].slice(0, 12);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });

    setJustInserted(char);
    setTimeout(() => {
      setJustInserted((cur) => (cur === char ? null : cur));
    }, 900);
  };

  const filteredSymbols = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      return ALL_SYMBOLS.filter((item) => {
        if (item.char === q) return true;
        if (item.name.toLowerCase().includes(q)) return true;
        return item.keywords.some((k) => k.toLowerCase().includes(q));
      });
    }

    if (activeCategory === 'popular') {
      return ALL_SYMBOLS.filter((item) => POPULAR_SYMBOLS.includes(item.char));
    }

    return ALL_SYMBOLS.filter((item) => item.category === activeCategory);
  }, [searchQuery, activeCategory]);

  return (
    <RibbonDropdown
      isOpen={isOpen}
      onClose={onClose}
      anchorRef={anchorRef}
      className="symbol-picker-dropdown"
      minWidth={360}
      style={{
        padding: '12px',
        width: '380px',
        maxWidth: '92vw',
        background: 'var(--bg-card, #ffffff)',
        color: 'var(--ink, #1f2937)',
        borderRadius: '8px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
        border: '1px solid var(--hairline, #e5e7eb)',
      }}
    >
      <div className="symbol-picker-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '13px' }}>
          <Sparkles size={16} style={{ color: 'var(--brand-onenote, #7719aa)' }} />
          <span>Вставка символов и знаков</span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px',
            color: 'var(--ink-secondary, #6b7280)',
            display: 'flex',
            alignItems: 'center',
          }}
          title="Закрыть"
        >
          <X size={14} />
        </button>
      </div>

      {/* Поле поиска */}
      <div
        className="symbol-search-box"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 10px',
          background: 'var(--bg-app, #f9fafb)',
          border: '1px solid var(--hairline, #d1d5db)',
          borderRadius: '6px',
          marginBottom: '10px',
        }}
      >
        <Search size={14} style={{ color: 'var(--ink-secondary, #6b7280)', flexShrink: 0 }} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Поиск: альфа, корень, омега, beta, sqrt..."
          style={{
            border: 'none',
            background: 'transparent',
            outline: 'none',
            fontSize: '12px',
            width: '100%',
            color: 'var(--ink, #111827)',
          }}
          autoFocus
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              color: 'var(--ink-secondary, #6b7280)',
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Недавние символы */}
      {!searchQuery && recentSymbols.length > 0 && (
        <div style={{ marginBottom: '10px' }}>
          <div
            style={{
              fontSize: '11px',
              color: 'var(--ink-secondary, #6b7280)',
              marginBottom: '4px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              fontWeight: 600,
            }}
          >
            Недавние:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {recentSymbols.map((char) => {
              const item = ALL_SYMBOLS.find((s) => s.char === char);
              return (
                <button
                  key={`recent-${char}`}
                  className="symbol-cell-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelectSymbol(char)}
                  onMouseEnter={() =>
                    setHoveredSymbol(
                      item || { char, name: char, category: 'popular', keywords: [] }
                    )
                  }
                  title={item ? `${item.char} — ${item.name}` : char}
                  style={{
                    width: '28px',
                    height: '28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                    background: 'var(--bg-app, #f3f4f6)',
                    border: '1px solid var(--hairline-subtle, #e5e7eb)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    color: 'var(--ink, #1f2937)',
                    transition: 'all 0.12s ease',
                  }}
                >
                  {char}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Вкладки категорий */}
      {!searchQuery && (
        <div
          className="symbol-category-tabs"
          style={{
            display: 'flex',
            gap: '4px',
            overflowX: 'auto',
            paddingBottom: '6px',
            marginBottom: '8px',
            borderBottom: '1px solid var(--hairline, #e5e7eb)',
          }}
        >
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              className={`symbol-tab-btn ${activeCategory === cat.id ? 'active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setActiveCategory(cat.id)}
              style={{
                padding: '4px 8px',
                fontSize: '11px',
                whiteSpace: 'nowrap',
                borderRadius: '4px',
                border: 'none',
                background:
                  activeCategory === cat.id
                    ? 'rgba(119, 25, 170, 0.12)'
                    : 'transparent',
                color:
                  activeCategory === cat.id
                    ? 'var(--brand-onenote, #7719aa)'
                    : 'var(--ink-secondary, #4b5563)',
                fontWeight: activeCategory === cat.id ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>
      )}

      {/* Сетка символов */}
      <div
        className="symbol-grid-scroll"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, 1fr)',
          gap: '4px',
          maxHeight: '190px',
          overflowY: 'auto',
          padding: '2px',
        }}
      >
        {filteredSymbols.map((item) => (
          <button
            key={`${item.category}-${item.char}`}
            className="symbol-cell-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleSelectSymbol(item.char)}
            onMouseEnter={() => setHoveredSymbol(item)}
            title={`${item.char} — ${item.name}`}
            style={{
              height: '34px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
              background: 'var(--bg-card, #ffffff)',
              border: '1px solid var(--hairline-subtle, #e5e7eb)',
              borderRadius: '5px',
              cursor: 'pointer',
              color: 'var(--ink, #111827)',
              transition: 'all 0.12s ease',
            }}
          >
            {item.char}
          </button>
        ))}

        {filteredSymbols.length === 0 && (
          <div
            style={{
              gridColumn: '1 / -1',
              textAlign: 'center',
              padding: '20px 0',
              fontSize: '12px',
              color: 'var(--ink-secondary, #6b7280)',
            }}
          >
            Символы по запросу «{searchQuery}» не найдены
          </div>
        )}
      </div>

      {/* Нижняя панель предпросмотра / статуса */}
      <div
        className="symbol-preview-bar"
        style={{
          marginTop: '10px',
          padding: '8px',
          background: 'var(--bg-app, #f9fafb)',
          borderRadius: '6px',
          border: '1px solid var(--hairline-subtle, #e5e7eb)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: '36px',
        }}
      >
        {justInserted ? (
          <div
            style={{
              fontSize: '12px',
              color: 'var(--brand-onenote, #7719aa)',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>Вставлено:</span>
            <span style={{ fontSize: '15px' }}>{justInserted}</span>
          </div>
        ) : hoveredSymbol ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
            <span
              style={{
                fontSize: '18px',
                fontWeight: 600,
                color: 'var(--brand-onenote, #7719aa)',
                minWidth: '22px',
                textAlign: 'center',
              }}
            >
              {hoveredSymbol.char}
            </span>
            <span
              style={{
                fontSize: '12px',
                color: 'var(--ink, #1f2937)',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
              }}
            >
              {hoveredSymbol.name}
            </span>
          </div>
        ) : (
          <div style={{ fontSize: '11px', color: 'var(--ink-secondary, #6b7280)' }}>
            Наведите на символ для описания, кликните для вставки
          </div>
        )}
      </div>
    </RibbonDropdown>
  );
};
