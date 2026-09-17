import React from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { useUiStore, RibbonTab } from '../../store/useUiStore';
import { RibbonHome } from './RibbonHome';
import { RibbonInsert } from './RibbonInsert';
import { RibbonDraw } from './RibbonDraw';
import { RibbonView } from './RibbonView';

interface TabItem {
  id: RibbonTab;
  label: string;
}

const TABS: TabItem[] = [
  { id: 'file', label: 'Файл' },
  { id: 'home', label: 'Главная' },
  { id: 'insert', label: 'Вставка' },
  { id: 'draw', label: 'Рисование' },
  { id: 'view', label: 'Вид' },
];

export const Ribbon: React.FC = () => {
  const {
    activeRibbonTab,
    setActiveRibbonTab,
    isRibbonCollapsed,
    toggleRibbonCollapsed,
    setExportOpen,
  } = useUiStore();

  const handleTabClick = (tabId: RibbonTab) => {
    if (tabId === 'file') {
      setExportOpen(true);
      return;
    }
    setActiveRibbonTab(tabId);
    if (isRibbonCollapsed) {
      toggleRibbonCollapsed();
    }
  };

  return (
    <div className={`ribbon-container ${isRibbonCollapsed ? 'collapsed' : ''}`}>
      {/* Полоса вкладок */}
      <div className="ribbon-tabs-strip">
        <div className="ribbon-tabs-list">
          {TABS.map((tab) => {
            const isActive = activeRibbonTab === tab.id;
            return (
              <button
                key={tab.id}
                className={`ribbon-tab-btn ${isActive ? 'active' : ''}`}
                onClick={() => handleTabClick(tab.id)}
              >
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Кнопка сворачивания ленты */}
        <button
          className="ribbon-collapse-btn"
          onClick={toggleRibbonCollapsed}
          title={isRibbonCollapsed ? 'Развернуть ленту' : 'Свернуть ленту'}
        >
          {isRibbonCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {/* Содержимое активной вкладки ленты */}
      {!isRibbonCollapsed && (
        <div className="ribbon-content">
          {activeRibbonTab === 'home' && <RibbonHome />}
          {activeRibbonTab === 'insert' && <RibbonInsert />}
          {activeRibbonTab === 'draw' && <RibbonDraw />}
          {activeRibbonTab === 'view' && <RibbonView />}
        </div>
      )}
    </div>
  );
};
