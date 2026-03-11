import React, { useEffect, useRef, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import {
  forceSimulation,
  forceRadial,
  forceManyBody,
  forceCollide,
  type SimulationNodeDatum,
} from 'd3-force';
import type { WordCloudNodeData } from '../types';

interface WordNode extends SimulationNodeDatum {
  text: string;
  topic: string;
  count: number;
  color: string;
  width: number;
  height: number;
}

const WordCloudCluster: React.FC<NodeProps<WordCloudNodeData>> = ({ data }) => {
  const { words } = data;
  const [wordNodes, setWordNodes] = useState<WordNode[]>([]);
  const simulationRef = useRef<ReturnType<typeof forceSimulation<WordNode>> | null>(null);
  const animationFrameRef = useRef<number>();

  useEffect(() => {
    if (words.length === 0) return;

    // Create word nodes with approximate dimensions
    const nodes: WordNode[] = words.map((word) => {
      const fontSize = Math.max(12, Math.min(24, 12 + word.count * 2));
      const width = word.text.length * fontSize * 0.6;
      const height = fontSize * 1.2;

      return {
        text: word.text,
        topic: word.topic,
        count: word.count,
        color: word.color,
        width,
        height,
        x: Math.random() * 400 - 200,
        y: Math.random() * 400 - 200,
      };
    });

    // Create d3-force simulation
    const simulation = forceSimulation<WordNode>(nodes)
      .force('radial', forceRadial(180, 0, 0).strength(0.1))
      .force('charge', forceManyBody<WordNode>().strength(-50))
      .force(
        'collide',
        forceCollide<WordNode>((d) => Math.max(d.width, d.height) / 2 + 5).strength(0.7)
      )
      .alphaDecay(0.001)
      .velocityDecay(0.4);

    simulationRef.current = simulation;

    // Update state on each tick using requestAnimationFrame for smooth 60fps
    const updatePositions = () => {
      setWordNodes([...simulation.nodes()]);
      animationFrameRef.current = requestAnimationFrame(updatePositions);
    };

    animationFrameRef.current = requestAnimationFrame(updatePositions);

    return () => {
      simulation.stop();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [words]);

  return (
    <div
      className="word-cloud-cluster"
      style={{
        position: 'relative',
        width: '400px',
        height: '400px',
        pointerEvents: 'none',
      }}
    >
      {/* Invisible handles for connections */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />

      {/* Render words as absolutely positioned HTML elements */}
      {wordNodes.map((node, index) => {
        const fontSize = Math.max(12, Math.min(24, 12 + node.count * 2));

        return (
          <div
            key={`${node.text}-${index}`}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: `translate(calc(-50% + ${node.x}px), calc(-50% + ${node.y}px))`,
              color: node.color,
              fontSize: `${fontSize}px`,
              fontWeight: 600,
              opacity: 0.7,
              whiteSpace: 'nowrap',
              pointerEvents: 'auto',
              cursor: 'pointer',
              transition: 'opacity 150ms ease',
              userSelect: 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.7';
            }}
            title={`${node.topic}: ${node.count} connection${node.count !== 1 ? 's' : ''}`}
          >
            {node.text}
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(WordCloudCluster);
