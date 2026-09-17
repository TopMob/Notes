import React, { useState, useEffect } from 'react';
import { Search, X, ArrowRight } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useNotebookStore } from '../../store/useNotebookStore';
import { useCanvasStore } from '../../store/useCanvasStore';
import { getDB } from '../../db/idb';

interface SearchResult {
  pageId: string;
  pageTitle: string;
  sectionTitle: string;
  blockText: string;
  x: number;
  y: number;
}

export const SearchModal: React.FC = () => {
  const { isSearchOpen, setSearchOpen } = useUiStore();
  const { pages, sections, selectPage } = useNotebookStore();
  const { setCamera } = useCanvasStore();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(!isSearchOpen);
      }
      if (e.key === 'Escape' && isSearchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen, setSearchOpen]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const search = async () => {
      setIsSearching(true);
      const db = await getDB();
      const allTextBlocks = await db.getAll('textBlocks');
      const q = query.toLowerCase();

      const pageMap = new Map(pages.map((p) => [p.id, p]));
      const secMap = new Map(sections.map((s) => [s.id, s]));

      const matches: SearchResult[] = [];

      for (const tb of allTextBlocks) {
        // Strip HTML
        const temp = document.createElement('div');
        temp.innerHTML = tb.contentHTML;
        const text = temp.innerText || '';

        if (text.toLowerCase().includes(q)) {
          const pg = pageMap.get(tb.pageId);
          const sec = pg ? secMap.get(pg.sectionId) : null;

          matches.push({
            pageId: tb.pageId,
            pageTitle: pg?.title || 'Страница',
            sectionTitle: sec?.title || 'Раздел',
            blockText: text.slice(0, 140),
            x: tb.x,
            y: tb.y,
          });
        }
      }

      setResults(matches);
      setIsSearching(false);
    };

    const timer = setTimeout(search, 200);
    return () => clearTimeout(timer);
  }, [query, pages, sections]);

  if (!isSearchOpen) return null;

  const handleSelectResult = async (res: SearchResult) => {
    const targetPage = pages.find((p) => p.id === res.pageId);
    if (targetPage) {
      await selectPage(targetPage);
      setCamera({
        x: res.x + 100,
        y: res.y + 50,
        zoom: 1.0,
      });
    }
    setSearchOpen(false);
  };

  return (
    <div className="modal-backdrop" onClick={() => setSearchOpen(false)}>
      <div className="modal-content search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <Search size={18} className="search-modal-icon" />
          <input
            type="text"
            className="search-modal-input"
            placeholder="Поиск по всем разделам и страницам..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {query && (
            <button className="search-clear-btn" onClick={() => setQuery('')}>
              <X size={16} />
            </button>
          )}
          <button className="modal-close-btn" onClick={() => setSearchOpen(false)}>
            <kbd>ESC</kbd>
          </button>
        </div>

        <div className="search-results-list">
          {isSearching && <div className="search-loading">Поиск...</div>}

          {!isSearching && query && results.length === 0 && (
            <div className="search-empty">Ничего не найдено по запросу «{query}»</div>
          )}

          {!isSearching &&
            results.map((res, idx) => (
              <div
                key={idx}
                className="search-result-item"
                onClick={() => handleSelectResult(res)}
              >
                <div className="result-header">
                  <span className="result-section">{res.sectionTitle}</span>
                  <span className="result-divider">/</span>
                  <span className="result-page">{res.pageTitle}</span>
                </div>
                <div className="result-body">{res.blockText}</div>
                <div className="result-arrow">
                  <ArrowRight size={14} />
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};
