import React, { useCallback, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import EntityNode from './EntityNode';
import MinorEntityNode from './MinorEntityNode';
import WordCloudCluster from './WordCloudCluster';
import ConnectionEdge from './ConnectionEdge';

import type {
  Entity,
  Topic,
  Connection,
  DataPoint,
  BoardFilters,
  EntityNodeData,
  WordCloudNodeData,
  ConnectionEdgeData,
  WordCloudWord,
} from '../types';

interface BoardProps {
  entities: Entity[];
  topics: Topic[];
  connections: Connection[];
  dataPoints: DataPoint[];
  filters: BoardFilters;
  selectedEntityId: string | null;
  onEntitySelect: (entityId: string) => void;
  focusEntityId: string | null;
  onFocusComplete: () => void;
}

const nodeTypes: NodeTypes = {
  entity: EntityNode,
  minorEntity: MinorEntityNode,
  wordCloud: WordCloudCluster,
};

const edgeTypes: EdgeTypes = {
  connection: ConnectionEdge,
};

const Board: React.FC<BoardProps> = ({
  entities,
  topics,
  connections,
  dataPoints,
  filters,
  selectedEntityId,
  onEntitySelect,
  focusEntityId,
  onFocusComplete,
}) => {
  // Create React Flow nodes
  const initialNodes = useMemo(() => {
    const nodes: Node[] = [];

    // Filter entities
    const visibleEntities = entities.filter((entity) => {
      if (entity.category === 'minor' && !filters.showMinorEntities) {
        return false;
      }
      return true;
    });

    // Position entities in a circular layout
    const primaryEntities = visibleEntities.filter((e) => e.category === 'primary');
    const minorEntities = visibleEntities.filter((e) => e.category === 'minor');

    const centerX = 500;
    const centerY = 400;
    const primaryRadius = 350;
    const minorRadius = 600;

    // Position primary entities
    primaryEntities.forEach((entity, index) => {
      const angle = (index / primaryEntities.length) * 2 * Math.PI - Math.PI / 2;
      const x = centerX + primaryRadius * Math.cos(angle);
      const y = centerY + primaryRadius * Math.sin(angle);

      const nodeData: EntityNodeData = {
        entity,
        onSelect: onEntitySelect,
      };

      nodes.push({
        id: entity.id,
        type: 'entity',
        position: { x, y },
        data: nodeData,
      });

      // Add word cloud for this entity if enabled
      if (filters.showWordClouds) {
        const words = generateWordCloudForEntity(entity.id, dataPoints, topics, filters);
        if (words.length > 0) {
          const wordCloudData: WordCloudNodeData = {
            entityId: entity.id,
            words,
          };

          nodes.push({
            id: `wordcloud-${entity.id}`,
            type: 'wordCloud',
            position: { x: x - 200, y: y - 200 },
            data: wordCloudData,
            selectable: false,
            draggable: false,
          });
        }
      }
    });

    // Position minor entities
    minorEntities.forEach((entity, index) => {
      const angle = (index / minorEntities.length) * 2 * Math.PI;
      const x = centerX + minorRadius * Math.cos(angle);
      const y = centerY + minorRadius * Math.sin(angle);

      const nodeData: EntityNodeData = {
        entity,
        onSelect: onEntitySelect,
      };

      nodes.push({
        id: entity.id,
        type: 'minorEntity',
        position: { x, y },
        data: nodeData,
      });
    });

    return nodes;
  }, [entities, dataPoints, topics, filters, onEntitySelect]);

  // Create React Flow edges
  const initialEdges = useMemo(() => {
    const edges: Edge[] = [];

    // Bundle connections between same entity pairs by topic
    const edgeMap = new Map<string, Connection[]>();

    connections.forEach((conn) => {
      // Skip if either entity is filtered out
      const sourceEntity = entities.find((e) => e.id === conn.sourceEntityId);
      const targetEntity = entities.find((e) => e.id === conn.targetEntityId);

      if (!sourceEntity || !targetEntity) return;

      if (
        (sourceEntity.category === 'minor' && !filters.showMinorEntities) ||
        (targetEntity.category === 'minor' && !filters.showMinorEntities)
      ) {
        return;
      }

      // Skip if topic is filtered out
      if (!filters.activeTopics.has(conn.topicName)) {
        return;
      }

      // Create edge key (sort entity IDs to handle bidirectional connections)
      const edgeKey = [conn.sourceEntityId, conn.targetEntityId].sort().join('-');

      if (!edgeMap.has(edgeKey)) {
        edgeMap.set(edgeKey, []);
      }
      edgeMap.get(edgeKey)!.push(conn);
    });

    // Create edges from bundled connections
    edgeMap.forEach((conns, edgeKey) => {
      const [sourceId, targetId] = edgeKey.split('-');

      // For display, use the most common topic color or the first one
      const topicCounts = new Map<string, number>();
      conns.forEach((c) => {
        topicCounts.set(c.topicName, (topicCounts.get(c.topicName) || 0) + 1);
      });

      const dominantTopic = Array.from(topicCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];
      const topic = topics.find((t) => t.name === dominantTopic);

      if (!topic) return;

      const edgeData: ConnectionEdgeData = {
        connections: conns,
        topicName: topic.name,
        color: topic.color,
        label: topic.name,
      };

      edges.push({
        id: `edge-${edgeKey}`,
        source: sourceId,
        target: targetId,
        type: 'connection',
        data: edgeData,
      });
    });

    return edges;
  }, [entities, connections, topics, filters]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes and edges when filters change
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Handle node selection
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === 'entity' || node.type === 'minorEntity') {
        onEntitySelect(node.id);
      }
    },
    [onEntitySelect]
  );

  // Handle pane click to deselect
  const onPaneClick = useCallback(() => {
    onEntitySelect('');
  }, [onEntitySelect]);

  // Focus on entity when requested from sidebar
  useEffect(() => {
    if (focusEntityId) {
      const node = nodes.find((n) => n.id === focusEntityId);
      if (node) {
        // Center and zoom on the node
        const reactFlowBounds = document.querySelector('.react-flow')?.getBoundingClientRect();
        if (reactFlowBounds) {
          // Trigger selection
          onEntitySelect(focusEntityId);
          onFocusComplete();
        }
      }
    }
  }, [focusEntityId, nodes, onEntitySelect, onFocusComplete]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      minZoom={0.3}
      maxZoom={1.5}
      defaultEdgeOptions={{
        type: 'connection',
      }}
    >
      <Background color="#2a2a3e" gap={16} size={1} />
      <Controls />
      <MiniMap
        nodeColor={(node) => {
          if (node.id === selectedEntityId) {
            return '#3498db';
          }
          return node.type === 'entity' ? '#e0e0e0' : '#888888';
        }}
        maskColor="rgba(26, 26, 46, 0.8)"
        style={{
          background: '#16213e',
          border: '1px solid #0f3460',
        }}
      />
    </ReactFlow>
  );
};

// Helper function to generate word cloud data for an entity
function generateWordCloudForEntity(
  entityId: string,
  dataPoints: DataPoint[],
  topics: Topic[],
  filters: BoardFilters
): WordCloudWord[] {
  // Count data points by topic for this entity
  const topicCounts = new Map<string, number>();

  dataPoints
    .filter((dp) => dp.entityId === entityId)
    .forEach((dp) => {
      if (filters.activeTopics.has(dp.topicName)) {
        topicCounts.set(dp.topicName, (topicCounts.get(dp.topicName) || 0) + 1);
      }
    });

  // Convert to word cloud words
  const words: WordCloudWord[] = [];
  topicCounts.forEach((count, topicName) => {
    const topic = topics.find((t) => t.name === topicName);
    if (topic) {
      words.push({
        text: topicName,
        topic: topic.name,
        count,
        color: topic.color,
        x: 0,
        y: 0,
      });
    }
  });

  return words;
}

export default React.memo(Board);
