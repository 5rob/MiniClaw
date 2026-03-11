import React, { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  type EdgeProps,
} from '@xyflow/react';
import type { ConnectionEdgeData } from '../types';

const ConnectionEdge: React.FC<EdgeProps<ConnectionEdgeData>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  if (!data) return null;

  const { connections, color, label, onClick } = data;

  // Bundle multiple connections into a thicker line
  const strokeWidth = Math.min(2 + connections.length * 0.5, 6);
  const baseOpacity = 0.5;
  const hoverOpacity = 0.9;
  const opacity = isHovered || selected ? hoverOpacity : baseOpacity;

  const [edgePath, labelX, labelY] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  // Handle click to show connection details
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClick) {
      onClick(connections, data.topicName);
    }
  };

  return (
    <>
      {/* Invisible wider stroke for easier clicking */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{
          cursor: 'pointer',
          pointerEvents: 'stroke',
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleClick}
      />

      {/* Visible edge */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth,
          strokeOpacity: opacity,
          transition: 'stroke-opacity 200ms ease, stroke-width 200ms ease',
          pointerEvents: 'none',
        }}
      />

      {/* Glow effect on hover */}
      {isHovered && (
        <path
          d={edgePath}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth + 4}
          strokeOpacity={0.3}
          style={{
            filter: 'blur(4px)',
            pointerEvents: 'none',
          }}
        />
      )}

      <EdgeLabelRenderer>
        {/* Edge label (visible on hover) */}
        {(isHovered || selected) && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                background: 'rgba(15, 52, 96, 0.95)',
                color: '#e0e0e0',
                padding: '6px 10px',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 600,
                border: `1px solid ${color}`,
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                whiteSpace: 'nowrap',
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
            <div
              style={{
                marginTop: '4px',
                fontSize: '10px',
                color: '#888',
                textAlign: 'center',
              }}
            >
              Click for details
            </div>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
};

export default React.memo(ConnectionEdge);
