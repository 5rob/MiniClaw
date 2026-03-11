# Investigation Board

A detective-style interactive entity relationship visualizer built with React Flow and d3-force physics.

## Features

- **Interactive Graph**: Pan, zoom, and explore entity relationships on a dark-themed canvas
- **Custom Nodes**: Primary and minor entity nodes with initials avatars and type-based coloring
- **Word Clouds**: Per-entity floating topic words with d3-force physics simulation
- **Connection Bundling**: Multiple connections between entities are bundled into thicker edges
- **Smart Filtering**: Filter by topic, search entities, toggle minor entities and word clouds
- **Entity Details**: Click an entity to view all its data points grouped by topic
- **Seed Data**: Comprehensive fictional corporate investigation scenario with 10 entities, 6 topics, and 20+ data points

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **React Flow v12** (`@xyflow/react`) - Graph visualization
- **d3-force** - Physics simulation for word clouds
- **Tailwind CSS** - Styling

## Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build

```bash
npm run build
```

The built files will be in the `dist/` directory.

### Preview Production Build

```bash
npm run preview
```

## Project Structure

```
investigation-board/
├── src/
│   ├── components/       # React components
│   │   ├── Board.tsx            # Main React Flow canvas
│   │   ├── EntityNode.tsx       # Primary entity node
│   │   ├── MinorEntityNode.tsx  # Minor entity node
│   │   ├── WordCloudCluster.tsx # Floating word cloud
│   │   ├── ConnectionEdge.tsx   # Custom edge with bundling
│   │   └── Sidebar.tsx          # Filtering and entity list
│   ├── data/
│   │   └── seedData.ts   # Fictional investigation data
│   ├── types.ts          # TypeScript type definitions
│   ├── App.tsx           # Main app component
│   ├── main.tsx          # Entry point
│   ├── index.css         # Global styles
│   └── App.css           # App-specific styles
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

## How It Works

### Entity Graph
The board displays entities as nodes in a circular layout. Primary entities (6) are positioned in an inner circle, while minor entities (4) are in an outer circle. Each node is draggable and clickable.

### Connections
Connections between entities are represented as colored edges based on their topic. If multiple connections exist between the same two entities, they're bundled into a single thicker edge.

### Word Clouds
When enabled, each primary entity has a floating word cloud showing its associated topics. The words orbit the entity using d3-force simulation with:
- `forceRadial` - keeps words in orbit around the entity
- `forceManyBody` - repels words from each other
- `forceCollide` - prevents overlap based on text bounding boxes
- Continuous gentle floating animation at 60fps

### Filtering
- **Search**: Filter entities by name
- **Topics**: Toggle topics on/off with colored checkboxes
- **Show Minor Entities**: Show/hide entities discovered through documents
- **Show Word Clouds**: Toggle floating topic words

### Sidebar
- Entity list with initials avatars
- Click to center board on that entity
- When entity is selected, shows all its data points grouped by topic

## Seed Data

The app includes a fictional corporate investigation scenario:

**Primary Entities:**
- Marcus Chen (CEO, Meridian Holdings)
- Senator Patricia Holwell (Senate Defence Committee)
- David Rothwell (Lobbyist)
- Meridian Holdings (Defence contractor)
- Apex Dynamics (Weapons manufacturer)
- Citizens for Progress PAC (Political action committee)

**Topics:**
- Lobbying
- Campaign Finance
- Government Contracts
- Tax Evasion
- Environmental Violations
- Board Memberships

**22 Data Points** with specific details, dates, and dollar amounts.

**22 Connections** mapping the relationships between entities through shared topics.

## Keyboard Shortcuts

- **Escape** - Deselect entity
- **F** - Fit view to see all entities
- **Mouse wheel** - Zoom in/out
- **Middle mouse / trackpad drag** - Pan the board

## License

MIT
