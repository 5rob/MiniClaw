import React, { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import type { ConnectionEdgeData } from '../types';

const ConnectionEdge: React.FC<EdgeProps<ConnectionEdgeData>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  if (!data) return null;

  const { connections, color, label } = data;

  // Bundle multiple connections into a thicker line
  const strokeWidth = Math.min(2 + connections.length * 0.5, 6);
  const baseOpacity = 0.4;
  const hoverOpacity = 0.8;
  const opacity = isHovered || selected ? hoverOpacity : baseOpacity;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Handle click to open source URL (if available and single connection)
  const handleClick = () => {
    if (connections.length === 1 && connections[0].sourceUrl) {
      window.open(connections[0].sourceUrl, '_blank');
    }
  };

  // Build tooltip content
  const tooltipContent =
    connections.length === 1
      ? connections[0].summary
      : `${connections.length} connections:\n${connections.map((c) => `• ${c.summary}`).join('\n')}`;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth,
          strokeOpacity: opacity,
          transition: 'stroke-opacity 150ms ease, stroke-width 150ms ease',
          cursor: connections.length === 1 && connections[0].sourceUrl ? 'pointer' : 'default',
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />

      <EdgeLabelRenderer>
        {/* Invisible hover area for better interaction */}
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
            padding: '20px',
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onClick={handleClick}
          title={tooltipContent}
        >
          {/* Edge label (visible on hover) */}
          {(isHovered || selected) && (
            <div
              style={{
                background: 'rgba(15, 52, 96, 0.95)',
                color: '#e0e0e0',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
                border: `1px solid ${color}`,
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                whiteSpace: 'nowrap',
                maxWidth: '200px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {label}
              {connections.length > 1 && (
                <span
                  style={{
                    marginLeft: '6px',
                    padding: '2px 6px',
                    background: color,
                    borderRadius: '10px',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    color: '#1a1a2e',
                  }}
                >
                  {connections.length}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Detailed tooltip on hover (multi-line) */}
        {isHovered && connections.length > 1 && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY + 30}px)`,
              pointerEvents: 'none',
              background: 'rgba(15, 52, 96, 0.98)',
              color: '#e0e0e0',
              padding: '12px',
              borderRadius: '6px',
              fontSize: '12px',
              border: `1px solid ${color}`,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              maxWidth: '300px',
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 'bold', marginBottom: '8px', color }}>
              {connections.length} Connections:
            </div>
            {connections.slice(0, 3).map((conn, idx) => (
              <div key={conn.id} style={{ marginBottom: '6px', fontSize: '11px' }}>
                <span style={{ color: '#888' }}>•</span> {conn.summary}
              </div>
            ))}
            {connections.length > 3 && (
              <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                ... and {connections.length - 3} more
              </div>
            )}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
};

export default React.memo(ConnectionEdge);
