import React, { useState, useCallback } from 'react';
import Board from './components/Board';
import Sidebar from './components/Sidebar';
import ConnectionDetailsModal from './components/ConnectionDetailsModal';
import { seedData } from './data/seedData';
import type { BoardFilters, TopicName, Connection } from './types';
import './App.css';

function App() {
  const { entities, topics, dataPoints, connections } = seedData;

  // Board filters state
  const [filters, setFilters] = useState<BoardFilters>({
    searchQuery: '',
    activeTopics: new Set<TopicName>(topics.map((t) => t.name)),
    showMinorEntities: true,
    showWordClouds: true,
  });

  // Selected entity state
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  // Focus entity state (when clicking from sidebar to center on board)
  const [focusEntityId, setFocusEntityId] = useState<string | null>(null);

  // Connection details modal state
  const [selectedConnection, setSelectedConnection] = useState<{
    connections: Connection[];
    topicName: string;
    topicColor: string;
  } | null>(null);

  // Handle filter changes
  const handleFilterChange = useCallback((newFilters: BoardFilters) => {
    setFilters(newFilters);
  }, []);

  // Handle entity selection
  const handleEntitySelect = useCallback((entityId: string) => {
    setSelectedEntityId(entityId || null);
  }, []);

  // Handle entity focus from sidebar
  const handleFocusEntity = useCallback((entityId: string) => {
    setFocusEntityId(entityId);
    setSelectedEntityId(entityId);
  }, []);

  // Clear focus after board centers on entity
  const handleFocusComplete = useCallback(() => {
    setFocusEntityId(null);
  }, []);

  // Handle connection click
  const handleConnectionClick = useCallback(
    (edgeConnections: Connection[], topicName: string) => {
      const topic = topics.find((t) => t.name === topicName);
      if (topic) {
        setSelectedConnection({
          connections: edgeConnections,
          topicName: topic.name,
          topicColor: topic.color,
        });
      }
    },
    [topics]
  );

  // Close connection modal
  const handleCloseConnectionModal = useCallback(() => {
    setSelectedConnection(null);
  }, []);

  return (
    <div className="app-container">
      <Sidebar
        entities={entities}
        topics={topics}
        dataPoints={dataPoints}
        filters={filters}
        selectedEntityId={selectedEntityId}
        onFilterChange={handleFilterChange}
        onEntitySelect={handleEntitySelect}
        onFocusEntity={handleFocusEntity}
      />
      <div className="board-container">
        <Board
          entities={entities}
          topics={topics}
          connections={connections}
          dataPoints={dataPoints}
          filters={filters}
          selectedEntityId={selectedEntityId}
          onEntitySelect={handleEntitySelect}
          focusEntityId={focusEntityId}
          onFocusComplete={handleFocusComplete}
          onConnectionClick={handleConnectionClick}
        />
      </div>

      {/* Connection details modal */}
      {selectedConnection && (
        <ConnectionDetailsModal
          connections={selectedConnection.connections}
          topicName={selectedConnection.topicName}
          topicColor={selectedConnection.topicColor}
          onClose={handleCloseConnectionModal}
        />
      )}
    </div>
  );
}

export default App;
