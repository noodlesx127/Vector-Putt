# UI Design System - Vector Putt

This document defines the consistent UI design patterns used across Vector Putt's major interface screens to maintain visual cohesion and user experience consistency.

## Overview

The Vector Putt UI system uses a **centered panel design** with consistent dimensions, colors, typography, and interaction patterns across Course Creator, Course Select, and User Made Levels screens.

## Core Design Principles

### 1. Centered Panel Layout
- **Fixed dimensions**: 800×600 pixels for primary panels
- **Responsive positioning**: Centered with margin constraints
- **Fallback sizing**: `Math.min(800, WIDTH - 80)` × `Math.min(600, HEIGHT - 120)` for smaller screens
- **Margin safety**: 20px minimum margin from screen edges

### 2. Visual Hierarchy
- **Dark overlay background**: Full-screen `rgba(0,0,0,0.8)` backdrop
- **Panel elevation**: Distinct panel with background and border
- **Content organization**: Title → Controls → List → Actions flow

## Design Specifications

### Panel Structure

```typescript
// Standard panel dimensions
const panelW = Math.min(800, WIDTH - 80);
const panelH = Math.min(600, HEIGHT - 120);
const panelX = (WIDTH - panelW) / 2;
const panelY = (HEIGHT - panelH) / 2;
```

### Color Palette

#### Backgrounds
- **Screen overlay**: `rgba(0,0,0,0.8)` - Full screen darkening
- **Panel background**: `rgba(20, 30, 40, 0.95)` - Main panel surface
- **Course Creator/Select**: `rgba(0,0,0,0.85)` - Slightly lighter variant
- **List items (unselected)**: `rgba(255, 255, 255, 0.05)` - Subtle highlight
- **List items (selected)**: `rgba(100, 150, 200, 0.3)` - Blue selection

#### Borders and Strokes
- **Panel border**: `rgba(100, 150, 200, 0.5)` - Blue panel outline
- **Course Creator/Select border**: `#cfd2cf` - Light gray variant
- **Selected item border**: `rgba(100, 150, 200, 0.8)` - Stronger blue
- **Unselected item border**: `rgba(255, 255, 255, 0.1)` - Subtle outline

#### Interactive Elements
- **Button backgrounds**: `rgba(100, 150, 200, 0.8)` - Primary blue
- **Button hover**: Increased opacity or white tint overlay
- **Filter active**: `rgba(100, 150, 200, 0.8)` - Blue highlight
- **Filter inactive**: `rgba(255, 255, 255, 0.1)` - Subtle background

#### Text Colors
- **Primary text**: `#ffffff` - White for titles and main content
- **Secondary text**: `#aaaaaa` - Gray for metadata and descriptions
- **Hint text**: `#888888` - Darker gray for instructions
- **Placeholder text**: `#cccccc` - Light gray for empty states

### Typography

#### Font Stack
- **Primary**: `system-ui, sans-serif` - Native system fonts for consistency

#### Font Sizes and Weights
- **Panel titles**: `24px` - Large, prominent headings
- **Section headers**: `20px` - Course Creator overlay titles
- **List items**: `16px` - Primary content text
- **Metadata**: `12px` - Secondary information
- **Instructions**: `11px` - Small guidance text
- **Buttons**: `14px` - Action text

#### Text Alignment
- **Titles**: `center` - Centered panel headers
- **List content**: `left` - Left-aligned for readability
- **Instructions**: `right` - Right-aligned hints
- **Buttons**: `center` - Centered button text

### Layout Specifications

#### Panel Spacing
- **Outer padding**: `20px` - Standard panel edge spacing
- **Content padding**: `16px` - Internal content spacing
- **Element gaps**: `12px` - Standard spacing between UI elements

#### List Design
- **Row height**: `40px` - Standard list item height
- **Item spacing**: `2px` - Gap between list items
- **Scroll indicators**: `8px` width, blue theme
- **Maximum visible**: Calculated based on available height

#### Button Layout
- **Standard height**: `28px` - Consistent button height
- **Large buttons**: `36px` - Primary action buttons
- **Button gaps**: `12px` - Spacing between adjacent buttons
- **Bottom alignment**: `20px` from panel bottom

## Screen-Specific Implementations

### Course Select
```typescript
// Panel: 800×600 centered with dark background
// Title: "Select Course" (24px, white, centered)
// List: Scrollable course entries with selection highlight
// Actions: Play Course, Course Creator (admin), User Made Levels
// Navigation: Back button (bottom-left)
```

### Course Creator (Admin Only)
```typescript
// Panel: 800×600 centered with dark background  
// Title: "Course Creator" (20px, white, left-aligned)
// List: Scrollable course list with "New Course" option
// Actions: Edit Course, New Course, Delete Course, Cancel
// Features: Row selection, scrollbar when needed
```

### User Made Levels
```typescript
// Panel: 800×600 centered with blue-themed background
// Title: "Level Browser" (24px, white, centered)
// Controls: Search bar + filter buttons (All/Bundled/User/Local)
// List: Scrollable level entries with metadata
// Actions: Back button (bottom-left)
// Features: Search integration, filter highlighting, empty states
```

## Interactive Patterns

### Selection States
- **Unselected**: Subtle background (`rgba(255,255,255,0.05)`)
- **Selected**: Blue highlight (`rgba(100,150,200,0.3)`)
- **Hover**: Increased opacity or white overlay

### Scrolling Behavior
- **Mouse wheel**: Supported on all list areas
- **Visual indicators**: Blue-themed scrollbars when content overflows
- **Smooth scrolling**: Single-item increments

### Button States
- **Default**: Blue background with white text
- **Hover**: Enhanced visual feedback
- **Disabled**: Grayed out with reduced opacity
- **Active**: Highlighted state for filters and toggles

### Empty States
- **Centered messaging**: Clear explanation of empty state
- **Helpful hints**: Guidance for user action
- **Consistent styling**: Maintains panel visual hierarchy

## Hotspot System

### Click Detection
```typescript
// Standardized hotspot structure
interface Hotspot {
  kind: 'levelItem' | 'btn' | 'filter' | 'search' | 'listItem';
  index?: number;
  action?: string;
  filterId?: string;
  x: number; y: number; w: number; h: number;
}
```

### Interaction Areas
- **List items**: Full row width for easy clicking
- **Buttons**: Standard button dimensions with padding
- **Filters**: Individual filter button areas
- **Search**: Click-to-activate search functionality

## Responsive Considerations

### Screen Size Adaptation
- **Minimum size**: Panels scale down but maintain usability
- **Margin preservation**: Always maintain minimum screen margins
- **Content overflow**: Scrolling handles content that exceeds panel size

### Cross-Platform Consistency
- **Font rendering**: System fonts ensure native appearance
- **Color accuracy**: RGBA values work across different displays
- **Interaction feedback**: Visual states provide clear user feedback

## Implementation Guidelines

### Code Organization
- **State management**: Dedicated state objects (`courseSelectState`, `userLevelsState`)
- **Hotspot arrays**: Rebuilt each frame for accurate hit detection
- **Rendering order**: Background → Panel → Content → Overlays

### Performance Considerations
- **Efficient rendering**: Only draw visible list items
- **State caching**: Minimize unnecessary recalculations
- **Event handling**: Precise hotspot detection for responsive interaction

### Accessibility
- **Keyboard navigation**: Arrow keys, Enter, Escape support
- **Visual feedback**: Clear selection and hover states
- **Readable text**: High contrast ratios for all text elements

---

This design system ensures consistent, professional, and user-friendly interfaces across all major UI components in Vector Putt while maintaining flexibility for future enhancements.
