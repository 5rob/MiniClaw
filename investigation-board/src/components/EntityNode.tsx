import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { EntityNodeData } from '../types';

const EntityNode: React.FC<NodeProps<EntityNodeData>> = ({ data, selected }) => {
  const { entity, onSelect } = data;

  // Map entity type to color
  const getBorderColor = () => {
    switch (entity.type) {
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

  const borderColor = getBorderColor();

  return (
    <div
      className="entity-node"
      style={{
        padding: '16px',
        background: '#1a1a2e',
        border: `2px solid ${selected ? borderColor : 'rgba(224, 224, 224, 0.3)'}`,
        borderRadius: '12px',
        minWidth: '160px',
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'all 150ms ease',
        boxShadow: selected
          ? `0 0 20px ${borderColor}40, 0 4px 12px rgba(0,0,0,0.4)`
          : '0 2px 8px rgba(0,0,0,0.3)',
      }}
      onClick={() => onSelect(entity.id)}
      onMouseEnter={(e) => {
        if (!selected) {
          e.currentTarget.style.boxShadow = `0 0 15px ${borderColor}30, 0 4px 12px rgba(0,0,0,0.4)`;
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
        }
      }}
    >
      {/* Connection handles */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />

      {/* Photo area or initials avatar */}
      <div
        style={{
          width: '120px',
          height: '120px',
          borderRadius: '50%',
          margin: '0 auto 12px',
          border: `2px solid ${borderColor}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: entity.photoUrl
            ? `url(${entity.photoUrl}) center/cover`
            : `linear-gradient(135deg, ${borderColor}40, ${borderColor}20)`,
          fontSize: '36px',
          fontWeight: 'bold',
          color: borderColor,
        }}
      >
        {!entity.photoUrl && entity.initials}
      </div>

      {/* Name */}
      <div
        style={{
          fontSize: '16px',
          fontWeight: 'bold',
          color: '#e0e0e0',
          marginBottom: '4px',
          lineHeight: 1.3,
        }}
      >
        {entity.name}
      </div>

      {/* Entity type */}
      <div
        style={{
          fontSize: '12px',
          color: '#888888',
          textTransform: 'capitalize',
        }}
      >
        {entity.type}
      </div>
    </div>
  );
};

export default React.memo(EntityNode);
