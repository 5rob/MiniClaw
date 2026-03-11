import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { EntityNodeData } from '../types';

const MinorEntityNode: React.FC<NodeProps<EntityNodeData>> = ({ data, selected }) => {
  const { entity, onSelect } = data;

  // Map entity type to color (muted for minor entities)
  const getBorderColor = () => {
    switch (entity.type) {
      case 'person':
        return '#a0a0a0';
      case 'company':
        return '#5a8fc4';
      case 'organisation':
        return '#4a9d6a';
      case 'government':
        return '#c45a5a';
      default:
        return '#a0a0a0';
    }
  };

  const borderColor = getBorderColor();

  return (
    <div
      className="minor-entity-node"
      style={{
        padding: '8px',
        background: '#1a1a2e',
        border: `1px solid ${selected ? borderColor : 'rgba(160, 160, 160, 0.2)'}`,
        borderRadius: '8px',
        minWidth: '100px',
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'all 150ms ease',
        boxShadow: selected
          ? `0 0 12px ${borderColor}30, 0 2px 6px rgba(0,0,0,0.3)`
          : '0 1px 4px rgba(0,0,0,0.2)',
      }}
      onClick={() => onSelect(entity.id)}
      onMouseEnter={(e) => {
        if (!selected) {
          e.currentTarget.style.boxShadow = `0 0 8px ${borderColor}20, 0 2px 6px rgba(0,0,0,0.3)`;
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.2)';
        }
      }}
    >
      {/* Invisible centered handle for connections */}
      <Handle
        type="source"
        position={Position.Top}
        id="center-source"
        style={{
          opacity: 0,
          pointerEvents: 'none',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      />
      <Handle
        type="target"
        position={Position.Top}
        id="center-target"
        style={{
          opacity: 0,
          pointerEvents: 'none',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      />

      {/* Initials circle */}
      <div
        style={{
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          margin: '0 auto 8px',
          border: `1px solid ${borderColor}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `linear-gradient(135deg, ${borderColor}30, ${borderColor}15)`,
          fontSize: '18px',
          fontWeight: 'bold',
          color: borderColor,
        }}
      >
        {entity.initials}
      </div>

      {/* Name */}
      <div
        style={{
          fontSize: '13px',
          fontWeight: '600',
          color: '#b0b0b0',
          lineHeight: 1.2,
        }}
      >
        {entity.name}
      </div>
    </div>
  );
};

export default React.memo(MinorEntityNode);
