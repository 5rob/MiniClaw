import React from 'react';
import type { Connection } from '../types';

interface ConnectionDetailsModalProps {
  connections: Connection[];
  topicName: string;
  topicColor: string;
  onClose: () => void;
}

const ConnectionDetailsModal: React.FC<ConnectionDetailsModalProps> = ({
  connections,
  topicName,
  topicColor,
  onClose,
}) => {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0f3460',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '80vh',
          overflow: 'auto',
          border: `2px solid ${topicColor}`,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ marginBottom: '20px', borderBottom: `2px solid ${topicColor}`, paddingBottom: '12px' }}>
          <h2
            style={{
              margin: 0,
              fontSize: '20px',
              fontWeight: 'bold',
              color: '#e0e0e0',
            }}
          >
            {topicName}
          </h2>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: '14px',
              color: '#888',
            }}
          >
            {connections.length} {connections.length === 1 ? 'connection' : 'connections'}
          </p>
        </div>

        {/* Connection list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {connections.map((conn) => (
            <div
              key={conn.id}
              style={{
                background: '#16213e',
                border: '1px solid #1e3a5f',
                borderRadius: '8px',
                padding: '16px',
              }}
            >
              {/* Source title */}
              {conn.sourceTitle && (
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 'bold',
                    color: topicColor,
                    marginBottom: '8px',
                  }}
                >
                  {conn.sourceTitle}
                </div>
              )}

              {/* Summary */}
              <div
                style={{
                  fontSize: '13px',
                  color: '#e0e0e0',
                  lineHeight: 1.6,
                  marginBottom: '12px',
                }}
              >
                {conn.summary}
              </div>

              {/* Source URL */}
              {conn.sourceUrl && (
                <a
                  href={conn.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: '12px',
                    color: '#3498db',
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.textDecoration = 'underline';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.textDecoration = 'none';
                  }}
                >
                  <span>View Source</span>
                  <span>→</span>
                </a>
              )}
            </div>
          ))}
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            marginTop: '20px',
            width: '100%',
            padding: '12px',
            background: topicColor,
            color: '#1a1a2e',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer',
            transition: 'opacity 200ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.8';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1';
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
};

export default ConnectionDetailsModal;
