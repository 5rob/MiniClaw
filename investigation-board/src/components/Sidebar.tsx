import React, { useState, useMemo } from 'react';
import type { Entity, Topic, DataPoint, BoardFilters, TopicName } from '../types';

interface SidebarProps {
  entities: Entity[];
  topics: Topic[];
  dataPoints: DataPoint[];
  filters: BoardFilters;
  selectedEntityId: string | null;
  onFilterChange: (filters: BoardFilters) => void;
  onEntitySelect: (entityId: string) => void;
  onFocusEntity: (entityId: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  entities,
  topics,
  dataPoints,
  filters,
  selectedEntityId,
  onFilterChange,
  onEntitySelect,
  onFocusEntity,
}) => {
  const [searchQuery, setSearchQuery] = useState(filters.searchQuery);

  // Filter entities based on search and filters
  const filteredEntities = useMemo(() => {
    return entities.filter((entity) => {
      // Search filter
      if (searchQuery && !entity.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }

      // Minor entity filter
      if (!filters.showMinorEntities && entity.category === 'minor') {
        return false;
      }

      return true;
    });
  }, [entities, searchQuery, filters.showMinorEntities]);

  // Get entity border color
  const getEntityColor = (type: string) => {
    switch (type) {
      case 'person':
        return '#e0e0e0';
      case 'company':
        return '#3498db';
      case 'organisation':
        return '#2ecc71';
      case 'government':
        return '#e74c3c';
      default:
        return '#e0e0e0';
    }
  };

  // Get data points for selected entity grouped by topic
  const selectedEntityDataPoints = useMemo(() => {
    if (!selectedEntityId) return [];

    const entityDps = dataPoints.filter((dp) => dp.entityId === selectedEntityId);
    const grouped = new Map<TopicName, DataPoint[]>();

    entityDps.forEach((dp) => {
      if (!grouped.has(dp.topicName)) {
        grouped.set(dp.topicName, []);
      }
      grouped.get(dp.topicName)!.push(dp);
    });

    return Array.from(grouped.entries());
  }, [selectedEntityId, dataPoints]);

  const selectedEntity = entities.find((e) => e.id === selectedEntityId);

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    onFilterChange({ ...filters, searchQuery: query });
  };

  const handleTopicToggle = (topicName: TopicName) => {
    const newActiveTopics = new Set(filters.activeTopics);
    if (newActiveTopics.has(topicName)) {
      newActiveTopics.delete(topicName);
    } else {
      newActiveTopics.add(topicName);
    }
    onFilterChange({ ...filters, activeTopics: newActiveTopics });
  };

  const handleToggleMinorEntities = () => {
    onFilterChange({ ...filters, showMinorEntities: !filters.showMinorEntities });
  };

  const handleToggleWordClouds = () => {
    onFilterChange({ ...filters, showWordClouds: !filters.showWordClouds });
  };

  return (
    <div className="sidebar-container" style={{ padding: '16px' }}>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#e0e0e0', margin: '0 0 8px 0' }}>
          Investigation Board
        </h2>
        <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
          {filteredEntities.length} {filteredEntities.length === 1 ? 'entity' : 'entities'}
        </p>
      </div>

      {/* Search bar */}
      <div style={{ marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Search entities..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            background: '#0f3460',
            border: '1px solid rgba(224, 224, 224, 0.2)',
            borderRadius: '6px',
            color: '#e0e0e0',
            fontSize: '14px',
            outline: 'none',
          }}
        />
      </div>

      {/* Topic filters */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: '600', color: '#e0e0e0', marginBottom: '10px' }}>
          Topics
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {topics.map((topic) => (
            <label
              key={topic.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: 'pointer',
                fontSize: '13px',
                color: '#e0e0e0',
              }}
            >
              <input
                type="checkbox"
                checked={filters.activeTopics.has(topic.name)}
                onChange={() => handleTopicToggle(topic.name)}
                style={{ accentColor: topic.color }}
              />
              <span
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: topic.color,
                  flexShrink: 0,
                }}
              />
              <span>{topic.name}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Display toggles */}
      <div style={{ marginBottom: '20px', paddingTop: '20px', borderTop: '1px solid #0f3460' }}>
        <h3 style={{ fontSize: '14px', fontWeight: '600', color: '#e0e0e0', marginBottom: '10px' }}>
          Display
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: '#e0e0e0' }}>
            <input
              type="checkbox"
              checked={filters.showMinorEntities}
              onChange={handleToggleMinorEntities}
              style={{ accentColor: '#3498db' }}
            />
            <span>Show Minor Entities</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: '#e0e0e0' }}>
            <input
              type="checkbox"
              checked={filters.showWordClouds}
              onChange={handleToggleWordClouds}
              style={{ accentColor: '#3498db' }}
            />
            <span>Show Word Clouds</span>
          </label>
        </div>
      </div>

      {/* Entity list or selected entity details */}
      {selectedEntity ? (
        <div style={{ paddingTop: '20px', borderTop: '1px solid #0f3460' }}>
          <button
            onClick={() => onEntitySelect('')}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#3498db',
              fontSize: '12px',
              cursor: 'pointer',
              marginBottom: '12px',
              padding: 0,
            }}
          >
            ← Back to all entities
          </button>

          <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: '#e0e0e0', marginBottom: '4px' }}>
            {selectedEntity.name}
          </h3>
          <p style={{ fontSize: '12px', color: '#888', marginBottom: '16px' }}>
            {selectedEntity.description}
          </p>

          {/* Data points grouped by topic */}
          {selectedEntityDataPoints.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {selectedEntityDataPoints.map(([topicName, dps]) => {
                const topic = topics.find((t) => t.name === topicName);
                return (
                  <div key={topicName}>
                    <h4
                      style={{
                        fontSize: '13px',
                        fontWeight: '600',
                        color: topic?.color,
                        marginBottom: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: topic?.color,
                        }}
                      />
                      {topicName}
                    </h4>
                    {dps.map((dp) => (
                      <div
                        key={dp.id}
                        style={{
                          background: '#0f3460',
                          padding: '10px',
                          borderRadius: '6px',
                          marginBottom: '8px',
                          fontSize: '12px',
                        }}
                      >
                        <div style={{ fontWeight: '600', color: '#e0e0e0', marginBottom: '4px' }}>
                          {dp.title}
                        </div>
                        <div style={{ color: '#b0b0b0', lineHeight: 1.4, marginBottom: '6px' }}>
                          {dp.summary}
                        </div>
                        {dp.sourceUrl && (
                          <a
                            href={dp.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#3498db', fontSize: '11px', textDecoration: 'none' }}
                          >
                            View source →
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <p style={{ fontSize: '13px', color: '#888' }}>No data points for this entity.</p>
          )}
        </div>
      ) : (
        <div style={{ paddingTop: '20px', borderTop: '1px solid #0f3460' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: '#e0e0e0', marginBottom: '10px' }}>
            Entities
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredEntities.map((entity) => (
              <div
                key={entity.id}
                onClick={() => onFocusEntity(entity.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px',
                  background: '#0f3460',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 150ms ease',
                  border: '1px solid transparent',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#1a5490';
                  e.currentTarget.style.borderColor = getEntityColor(entity.type);
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#0f3460';
                  e.currentTarget.style.borderColor = 'transparent';
                }}
              >
                {/* Initials avatar */}
                <div
                  style={{
                    width: entity.category === 'primary' ? '40px' : '32px',
                    height: entity.category === 'primary' ? '40px' : '32px',
                    borderRadius: '50%',
                    border: `2px solid ${getEntityColor(entity.type)}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: `${getEntityColor(entity.type)}20`,
                    fontSize: entity.category === 'primary' ? '14px' : '12px',
                    fontWeight: 'bold',
                    color: getEntityColor(entity.type),
                    flexShrink: 0,
                  }}
                >
                  {entity.initials}
                </div>

                {/* Name and type */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: entity.category === 'primary' ? '14px' : '13px',
                      fontWeight: entity.category === 'primary' ? '600' : '500',
                      color: '#e0e0e0',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {entity.name}
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: '#888',
                      textTransform: 'capitalize',
                    }}
                  >
                    {entity.type}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(Sidebar);
