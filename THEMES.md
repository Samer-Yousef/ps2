# Theme System

This application includes a flexible theme system with three built-in themes: **Light**, **Dark**, and **Sepia**.

## Available Themes

### 1. Light Theme (Default)
- Clean white background
- Dark text for maximum contrast
- Standard light mode for daytime use

### 2. Dark Theme
- Dark background (#0a0a0a)
- Light text for reduced eye strain
- Ideal for low-light environments

### 3. Sepia Theme
- Warm beige/cream tones (#f5f1e8)
- Reduces blue light exposure
- Easier on eyes for extended viewing sessions
- Particularly suited for medical professionals reviewing slides

## How to Use

Users can switch themes using the theme selector dropdown in the top-right corner of the page. The theme preference is automatically saved to localStorage and persists across sessions.

## Technical Implementation

### Theme Provider
The theme system is managed by `ThemeProvider.tsx` which:
- Provides theme context to all components
- Saves theme preference to localStorage
- Applies the appropriate class to the HTML element

### CSS Variables
Theme colors are defined in `globals.css` using CSS custom properties:

```css
/* Light Theme */
.light {
  --background: #ffffff;
  --foreground: #171717;
  --card-bg: #ffffff;
  --card-border: #e5e5e5;
  --muted: #6b7280;
  --accent: #0069ff;
}

/* Dark Theme */
.dark {
  --background: #0a0a0a;
  --foreground: #ededed;
  --card-bg: #1a1a1a;
  --card-border: #2a2a2a;
  --muted: #9ca3af;
  --accent: #0069ff;
}

/* Sepia Theme */
.sepia {
  --background: #f5f1e8;
  --foreground: #3e3527;
  --card-bg: #faf8f3;
  --card-border: #d9d0c0;
  --muted: #7a7364;
  --accent: #0069ff;
}
```

### Using Themes in Components

Components use Tailwind CSS classes with theme-specific variants:

```tsx
// Example: Button with theme support
<button className="bg-gray-200 dark:bg-gray-700 sepia:bg-[#e8dfc8]">
  Click me
</button>

// Example: Text with theme support
<p className="text-gray-600 dark:text-gray-400 sepia:text-gray-700">
  Some text
</p>
```

## Adding New Themes

To add a new theme:

1. **Add theme colors to `globals.css`:**
```css
.mytheme {
  --background: #yourcolor;
  --foreground: #yourcolor;
  --card-bg: #yourcolor;
  --card-border: #yourcolor;
  --muted: #yourcolor;
  --accent: #0069ff;
}
```

2. **Update `ThemeProvider.tsx`:**
```typescript
type Theme = 'light' | 'dark' | 'sepia' | 'mytheme';
```

3. **Add to ThemeSelector:**
```typescript
const themes = [
  { value: 'light', label: 'Light', icon: '☀️' },
  { value: 'dark', label: 'Dark', icon: '🌙' },
  { value: 'sepia', label: 'Sepia', icon: '📄' },
  { value: 'mytheme', label: 'My Theme', icon: '🎨' },
] as const;
```

4. **Apply theme classes to components:**
```tsx
<div className="bg-white dark:bg-gray-900 sepia:bg-[#f5f1e8] mytheme:bg-[#yourcolor]">
```

## Files Modified for Theme System

- `src/components/ThemeProvider.tsx` - Theme context provider
- `src/components/ThemeSelector.tsx` - Theme switcher UI component
- `src/components/Providers.tsx` - Wraps app with ThemeProvider
- `src/app/globals.css` - Theme CSS variables and styling
- `src/app/page.tsx` - Added ThemeSelector and theme classes
- `src/app/dashboard/page.tsx` - Added ThemeSelector and theme classes
