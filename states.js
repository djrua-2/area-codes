/*
  AREA CODES — states.js
  ----------------------
  Tile-grid coordinates for all 50 states + DC. This is a stylized
  cartogram layout (every state gets one equally-sized cell), not a
  geographically precise map — that's intentional; it's what makes every
  state equally easy to click regardless of its real-world size or shape.

  Grid coordinates are adapted from the row/col layout used by the
  R "statebins" package (Bob Rudis, https://github.com/hrbrmstr/statebins),
  a well-established reference layout for exactly this kind of tile map.

  You should not need to edit this file — it's just geography, not content.
  To add content for a state, edit data.js instead.
*/

const STATE_GRID = [
  { abbrev: "AL", name: "Alabama", col: 8, row: 7 },
  { abbrev: "AK", name: "Alaska", col: 1, row: 7 },
  { abbrev: "AZ", name: "Arizona", col: 3, row: 6 },
  { abbrev: "AR", name: "Arkansas", col: 6, row: 6 },
  { abbrev: "CA", name: "California", col: 2, row: 5 },
  { abbrev: "CO", name: "Colorado", col: 4, row: 5 },
  { abbrev: "CT", name: "Connecticut", col: 11, row: 4 },
  { abbrev: "DC", name: "District of Columbia", col: 10, row: 6 },
  { abbrev: "DE", name: "Delaware", col: 11, row: 5 },
  { abbrev: "FL", name: "Florida", col: 10, row: 8 },
  { abbrev: "GA", name: "Georgia", col: 9, row: 7 },
  { abbrev: "HI", name: "Hawaii", col: 1, row: 8 },
  { abbrev: "ID", name: "Idaho", col: 3, row: 3 },
  { abbrev: "IL", name: "Illinois", col: 7, row: 3 },
  { abbrev: "IN", name: "Indiana", col: 7, row: 4 },
  { abbrev: "IA", name: "Iowa", col: 6, row: 4 },
  { abbrev: "KS", name: "Kansas", col: 5, row: 6 },
  { abbrev: "KY", name: "Kentucky", col: 7, row: 5 },
  { abbrev: "LA", name: "Louisiana", col: 6, row: 7 },
  { abbrev: "ME", name: "Maine", col: 12, row: 1 },
  { abbrev: "MD", name: "Maryland", col: 10, row: 5 },
  { abbrev: "MA", name: "Massachusetts", col: 11, row: 3 },
  { abbrev: "MI", name: "Michigan", col: 8, row: 3 },
  { abbrev: "MN", name: "Minnesota", col: 6, row: 3 },
  { abbrev: "MS", name: "Mississippi", col: 7, row: 7 },
  { abbrev: "MO", name: "Missouri", col: 6, row: 5 },
  { abbrev: "MT", name: "Montana", col: 4, row: 3 },
  { abbrev: "NE", name: "Nebraska", col: 5, row: 5 },
  { abbrev: "NV", name: "Nevada", col: 3, row: 4 },
  { abbrev: "NH", name: "New Hampshire", col: 12, row: 2 },
  { abbrev: "NJ", name: "New Jersey", col: 10, row: 4 },
  { abbrev: "NM", name: "New Mexico", col: 4, row: 6 },
  { abbrev: "NY", name: "New York", col: 10, row: 3 },
  { abbrev: "NC", name: "North Carolina", col: 8, row: 6 },
  { abbrev: "ND", name: "North Dakota", col: 5, row: 3 },
  { abbrev: "OH", name: "Ohio", col: 8, row: 4 },
  { abbrev: "OK", name: "Oklahoma", col: 5, row: 7 },
  { abbrev: "OR", name: "Oregon", col: 2, row: 4 },
  { abbrev: "PA", name: "Pennsylvania", col: 9, row: 4 },
  { abbrev: "RI", name: "Rhode Island", col: 12, row: 4 },
  { abbrev: "SC", name: "South Carolina", col: 9, row: 6 },
  { abbrev: "SD", name: "South Dakota", col: 5, row: 4 },
  { abbrev: "TN", name: "Tennessee", col: 7, row: 6 },
  { abbrev: "TX", name: "Texas", col: 5, row: 8 },
  { abbrev: "UT", name: "Utah", col: 3, row: 5 },
  { abbrev: "VT", name: "Vermont", col: 11, row: 2 },
  { abbrev: "VA", name: "Virginia", col: 9, row: 5 },
  { abbrev: "WA", name: "Washington", col: 2, row: 3 },
  { abbrev: "WV", name: "West Virginia", col: 8, row: 5 },
  { abbrev: "WI", name: "Wisconsin", col: 7, row: 2 },
  { abbrev: "WY", name: "Wyoming", col: 4, row: 4 }
];
