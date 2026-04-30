export const TODOIST_COLORS = [
  { id: 30, name: 'berry_red', hex: '#B8255F' },
  { id: 31, name: 'red', hex: '#DB4035' },
  { id: 32, name: 'orange', hex: '#FF9933' },
  { id: 33, name: 'yellow', hex: '#F8CA00' },
  { id: 34, name: 'olive_green', hex: '#AFB83B' },
  { id: 35, name: 'lime_green', hex: '#7ECC49' },
  { id: 36, name: 'green', hex: '#299438' },
  { id: 37, name: 'mint_green', hex: '#6ACCBC' },
  { id: 38, name: 'teal', hex: '#158FAD' },
  { id: 39, name: 'sky_blue', hex: '#14AAF5' },
  { id: 40, name: 'light_blue', hex: '#96C3EB' },
  { id: 41, name: 'blue', hex: '#4073FF' },
  { id: 42, name: 'grape', hex: '#884DFF' },
  { id: 43, name: 'violet', hex: '#AF38EB' },
  { id: 44, name: 'lavender', hex: '#EB96EB' },
  { id: 45, name: 'magenta', hex: '#E05194' },
  { id: 46, name: 'salmon', hex: '#FF8D85' },
  { id: 47, name: 'charcoal', hex: '#808080' },
  { id: 48, name: 'grey', hex: '#B8B8B8' },
  { id: 49, name: 'taupe', hex: '#CCAC93' },
] as const;

export const TODOIST_COLOR_NAMES = TODOIST_COLORS.map((color) => color.name);
