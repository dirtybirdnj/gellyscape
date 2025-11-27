# USGS GeoPDF Layer Structure Comparison Chart

This document provides a detailed side-by-side comparison of layer structures across different USGS map scales and vintages.

## Layer Presence Matrix

| Layer Name | 75k (2025) | 250k (2025) | 100k (2025) | 7.5min (2024) | 7.5min (2023) | Notes |
|------------|:----------:|:-----------:|:-----------:|:-------------:|:-------------:|-------|
| **Labels** | ✓ (2x) | ✓ | - | ✓ | ✓ | 75k has duplicate layer |
| **Map Collar** | ✓ | ✓ | ✓ | ✓ | ✓ | Universal |
| **Map Elements** | ✓ | ✓ | - | ✓ | ✓ | Missing in 100k |
| **Map Frame** | ✓ | ✓ | ✓ | ✓ | ✓ | Universal |
| **Boundaries** | - | ✓ | ✓ | ✓ | ✓ | Top-level group |
| **Federal Administrated Lands** | - | ✓ | ✓ | - | - | 100k/250k only |
| **Department of Defense** | - | ✓ | - | - | - | 250k only |
| **Fish and Wildlife Service** | - | ✓ | - | - | - | 250k only |
| **U.S. Fish and Wildlife Service** | - | - | ✓ | - | - | 100k only (different name) |
| **National Park Service** | - | - | ✓ | - | - | 100k only |
| **Wilderness** | - | ✓ | - | - | - | 250k only |
| **Forest Service** | - | ✓ | - | - | - | 250k only |
| **Jurisdictional Boundaries** | - | ✓ | ✓ | ✓ | ✓ | Sub-group |
| **County or Equivalent** | - | ✓ | ✓ | ✓ | ✓ | Under Jurisdictional |
| **State or Territory** | - | ✓ | ✓ | ✓ | ✓ | Under Jurisdictional |
| **International** | - | ✓ | - | - | ✓ | 250k and some 7.5min |
| **Land Cover** | ✓ | ✓ | ✓ | - | - | 2025 format only |
| **Woodland** | - | - | - | ✓ | ✓ | 2024/2023 format only |
| **Terrain** | ✓ | ✓ | ✓ | ✓ | ✓ | Universal |
| **Shaded Relief** | - | - | ✓ | ✓ | ✓ | Missing in 250k/75k |
| **Contours** | ✓ | ✓ | ✓ | ✓ | ✓ | Universal |
| **Hydrography** | ✓ | ✓ | ✓ | ✓ | ✓ | Universal |
| **Wetlands** | ✓ | - | ✓ | ✓ | ✓ | Missing in 250k |
| **General Hydrography** | ✓ | ✓ | ✓ | - | - | 2025 format only |
| **Transportation** | ✓ | ✓ | ✓ | ✓ | ✓ | Universal |
| **Airports** | ✓ | ✓ | ✓ | ✓ | ✓ | Universal |
| **Railroads** | ✓ | - | - | ✓ | ✓ | Missing in 100k/250k |
| **Trails** | ✓ | - | - | - | - | 75k only |
| **Roads** | ✓ | ✓ | ✓ | - | - | 2025 format |
| **Road Features** | - | - | - | ✓ | ✓ | 2024/2023 format only |
| **Road Shields** | ✓ | ✓ | ✓ | - | - | 2025 format |
| **Road Names and Shields** | - | - | - | ✓ | - | 2024 format only |
| **Structures** | ✓ | ✓ | ✓ | ✓ | ✓ | Universal |
| **Recreation** | ✓ | - | ✓ | - | - | 75k and 100k only |
| **Public Services** | ✓ | ✓ | ✓ | - | - | 2025 format only |
| **Emergency Services** | ✓ | - | ✓ | - | - | 75k and 100k only |
| **Geographic Names** | ✓ | ✓ | ✓ | ✓ | ✓ | Universal |
| **Populated Places** | ✓ | ✓ | ✓ | - | - | 2025 format only |
| **Natural Features** | ✓ | ✓ | ✓ | - | - | 2025 format only |
| **Projection and Grids** | ✓ | ✓ | ✓ | ✓ | ✓ | Universal |
| **Images** | - | - | - | ✓ | - | 2024 format only |
| **Orthoimage** | - | - | - | ✓ | - | 2024 format only |
| **Barcode** | - | - | - | ✓ | - | 2024 format only |
| **TOTAL LAYERS** | **25** | **29** | **28** | **26** | **26** | |

---

## Layer Organization Patterns

### Universal Layers (Present in All Formats)
These layers appear in every analyzed PDF regardless of scale or vintage:
- Map Collar
- Map Frame
- Terrain
- Contours
- Hydrography
- Transportation
- Airports
- Structures
- Geographic Names
- Projection and Grids

### Scale-Dependent Layers

#### Large Scale Only (250k, 100k)
These layers only appear in the smaller scale (wider coverage) maps:
- Federal Administrated Lands (with sub-categories)
- Extensive boundary/jurisdictional hierarchies

#### Small Scale Only (75k, 7.5-minute)
These layers only appear in the larger scale (detailed) maps:
- Railroads
- Trails (75k only)
- Detailed road features

### Vintage-Dependent Layers

#### 2025 Format (Newer ArcSOC)
- Land Cover (replaces Woodland)
- General Hydrography
- Roads (separate from Road Features)
- Road Shields (separate)
- Public Services
- Emergency Services
- Populated Places
- Natural Features

#### 2024/2023 Format (Older ArcSOC)
- Woodland (replaced by Land Cover)
- Road Features (combined with roads)
- Road Names and Shields (combined)
- Images
- Orthoimage
- Barcode

---

## Hierarchical Layer Structure

### 75k (2025) - 25 Layers
```
├── Labels (2x - duplicate)
├── Map Collar
├── Map Elements
├── Map Frame
├── Land Cover
├── Terrain
├── Contours
├── Hydrography
│   ├── Wetlands
│   └── General Hydrography
├── Transportation
│   ├── Airports
│   ├── Railroads
│   ├── Trails
│   ├── Roads
│   └── Road Shields
├── Structures
├── Recreation
├── Public Services
├── Emergency Services
├── Geographic Names
│   ├── Populated Places
│   └── Natural Features
└── Projection and Grids
```

### 250k (2025) - 29 Layers
```
├── Labels
├── Map Collar
├── Map Elements
├── Map Frame
├── Boundaries
│   ├── Federal Administrated Lands
│   │   ├── Department of Defense
│   │   ├── Fish and Wildlife Service
│   │   ├── Wilderness
│   │   └── Forest Service
│   └── Jurisdictional Boundaries
│       ├── County or Equivalent
│       ├── State or Territory
│       └── International
├── Land Cover
├── Terrain
├── Contours
├── Hydrography
│   └── General Hydrography
├── Transportation
│   ├── Roads
│   ├── Road Shields
│   └── Airports
├── Structures
├── Public Services
├── Geographic Names
│   ├── Populated Places
│   └── Natural Features
└── Projection and Grids
```

### 100k (2025) - 28 Layers
```
├── Map Collar
├── Map Frame
├── Boundaries
│   ├── Federal Administrated Lands
│   │   ├── U.S. Fish and Wildlife Service
│   │   └── National Park Service
│   └── Jurisdictional Boundaries
│       ├── County or Equivalent
│       └── State or Territory
├── Land Cover
├── Terrain
│   └── Shaded Relief
├── Contours
├── Hydrography
│   ├── Wetlands
│   └── General Hydrography
├── Transportation
│   ├── Airports
│   ├── Roads
│   └── Road Shields
├── Structures
├── Recreation
├── Public Services
├── Emergency Services
├── Geographic Names
│   ├── Populated Places
│   └── Natural Features
└── Projection and Grids
```

### 7.5-minute (2024) - 26 Layers
```
├── Labels
├── Map Collar
├── Map Elements
├── Map Frame
├── Boundaries
│   └── Jurisdictional Boundaries
│       ├── County or Equivalent
│       └── State or Territory
├── Woodland
├── Terrain
│   └── Shaded Relief
├── Contours
├── Hydrography
│   └── Wetlands
├── Transportation
│   ├── Airports
│   ├── Railroads
│   ├── Trails
│   ├── Road Features
│   └── Road Names and Shields
├── Structures
├── Geographic Names
├── Projection and Grids
├── Images
│   ├── Orthoimage
│   └── Barcode
```

---

## Key Observations

### 1. Layer Count Progression
- **75k (simplified detail):** 25 layers
- **7.5-minute (high detail):** 26 layers
- **100k (medium scale):** 28 layers
- **250k (small scale):** 29 layers

**Pattern:** Smaller scales (wider coverage) have MORE layers due to administrative/boundary data.

### 2. Layer Naming Changes
#### Woodland → Land Cover
- **Old (2024/2023):** "Woodland" layer
- **New (2025):** "Land Cover" layer
- **Impact:** May require feature type mapping updates

#### Road Organization
- **Old (2024/2023):** "Road Features" + "Road Names and Shields" (combined)
- **New (2025):** "Roads" + "Road Shields" (separate)
- **Impact:** Different layer granularity for road data

#### Geographic Names
- **Old (2024/2023):** Single "Geographic Names" layer
- **New (2025):** "Geographic Names" with sub-layers:
  - Populated Places
  - Natural Features
- **Impact:** More specific place name categorization

### 3. Format-Specific Features

#### Small Scale Maps (250k, 100k)
**Focus on:** Administrative boundaries, federal lands, jurisdictions
**Less detail on:** Recreation, services, trails
**Page size:** Larger, landscape orientation

#### Large Scale Maps (75k, 7.5-minute)
**Focus on:** Detailed features, trails, specific services
**Less detail on:** Administrative hierarchies
**Page size:** Standard (24" x 29"), portrait orientation

---

## Color Palette Patterns (Where Extractable)

### 7.5-minute (2024) Color Scheme

**Vegetation/Land Cover:**
- #5c8944 - Dark green (woodland)
- #a8d483 - Light green (vegetation)
- #89ace0 - Stroked water features

**Water Features:**
- #73b2ff - Blue (water bodies)
- #aecbf8 - Light blue (shallow water)
- #89ace0 - Blue stroke (water outlines)

**Infrastructure:**
- #e1e1e1 - Light gray (contour lines)
- #f0f0f0 - Very light gray (roads)
- #000000 - Black (text, outlines)
- #ffffff - White (background)

**Special Features:**
- #ff0000 - Red (emergency/important)
- #0000ff - Blue (water/special)
- #a83800 - Brown (structures)
- #4169e1 - Royal blue (special features)

### Color Extraction Status by Format

| Format | Colors Extracted | Status | Notes |
|--------|------------------|--------|-------|
| 75k (2025) | 0 | ❌ Failed | XObject or encoded content |
| 250k (2025) | 0 | ❌ Failed | XObject or encoded content |
| 100k (2025) | 0 | ❌ Failed | XObject or encoded content |
| 7.5min (2024) | 45 | ✅ Success | Inline content streams |
| 7.5min (2023) | 31 | ✅ Success | Inline content streams |

**Recommendation:** Update color extraction to handle Form XObjects and raster data for 2025 formats.

---

## Implementation Recommendations

### Layer Mapping Strategy

```javascript
// Don't force unified layer names - preserve originals
const LAYER_MAPPINGS = {
  '2025': {
    landCover: 'Land Cover',
    roads: 'Roads',
    roadShields: 'Road Shields'
  },
  '2024': {
    landCover: 'Woodland',
    roads: 'Road Features',
    roadShields: 'Road Names and Shields'
  }
};

function getLayerName(format, category) {
  const yearFormat = format.includes('2025') ? '2025' : '2024';
  return LAYER_MAPPINGS[yearFormat][category] || category;
}
```

### Feature Categorization

```javascript
const LAYER_CATEGORIES = {
  // Core map elements
  INFRASTRUCTURE: ['Map Collar', 'Map Elements', 'Map Frame'],

  // Boundaries and jurisdictions
  BOUNDARIES: ['Boundaries', 'Jurisdictional Boundaries', 'County or Equivalent',
               'State or Territory', 'International'],

  // Federal lands
  FEDERAL_LANDS: ['Federal Administrated Lands', 'Department of Defense',
                  'Fish and Wildlife Service', 'Wilderness', 'Forest Service',
                  'National Park Service'],

  // Natural features
  NATURAL: ['Land Cover', 'Woodland', 'Terrain', 'Shaded Relief'],

  // Topography
  TOPOGRAPHY: ['Contours'],

  // Water features
  WATER: ['Hydrography', 'Wetlands', 'General Hydrography'],

  // Transportation
  TRANSPORTATION: ['Transportation', 'Roads', 'Road Features', 'Road Shields',
                   'Road Names and Shields', 'Airports', 'Railroads', 'Trails'],

  // Structures and facilities
  STRUCTURES: ['Structures', 'Recreation', 'Public Services', 'Emergency Services'],

  // Labels and names
  LABELS: ['Labels', 'Geographic Names', 'Populated Places', 'Natural Features'],

  // Reference
  REFERENCE: ['Projection and Grids'],

  // Imagery (2024 only)
  IMAGERY: ['Images', 'Orthoimage', 'Barcode']
};
```

### Format Detection

```javascript
function identifyUSGSFormat(metadata, layers) {
  // Detect scale
  let scale = 'unknown';
  if (metadata.Subject) {
    if (metadata.Subject.includes('250K')) scale = '250k';
    else if (metadata.Subject.includes('100K')) scale = '100k';
    else if (metadata.Subject.includes('24K')) scale = '75k/7.5min';
  }

  // Detect vintage by layer names
  const hasLandCover = layers.some(l => l.name === 'Land Cover');
  const hasWoodland = layers.some(l => l.name === 'Woodland');
  const vintage = hasLandCover ? '2025' : (hasWoodland ? '2024' : 'unknown');

  // Detect by creator version
  const creatorVersion = metadata.Creator?.match(/(\d+\.\d+)/)?.[1];
  const isNewer = parseFloat(creatorVersion) >= 13.0;

  return {
    scale,
    vintage,
    isNewer,
    layerCount: layers.length,
    format: `${scale}-${vintage}`
  };
}
```

---

## Summary

### Critical Differences by Format

**250k:**
- 29 layers (most)
- Extensive boundary/admin layers
- No wetlands, railroads, or trails
- Landscape orientation
- Largest page size (33" x 26")

**100k:**
- 28 layers
- Federal lands (different agencies than 250k)
- Has shaded relief
- Includes recreation/emergency services
- Large landscape (46" x 30")

**75k (2025):**
- 25 layers
- Most comprehensive feature set
- Includes trails, railroads
- Portrait orientation (24" x 29")
- Same page size as 7.5-minute

**7.5-minute (2024):**
- 26 layers
- "Woodland" instead of "Land Cover"
- Includes orthoimage and barcode
- Combined road features
- Standard quad size (24" x 29")

### Preservation Priorities

1. **DO NOT force unified layer names** - preserve original names
2. **DO NOT enforce color standardization** - keep format-specific palettes
3. **DO track format metadata** - scale, vintage, creator version
4. **DO handle layer hierarchy** - some layers have parent-child relationships
5. **DO preserve all layers** - even format-specific ones like Barcode or Orthoimage
