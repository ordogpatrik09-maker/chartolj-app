module.exports = {
  darkMode: 'class',
  content: ['./index.html'],
  safelist: [
    // A kódban DINAMIKUSAN (string-interpolációval) összeállított class-nevek
    // (pl. `bg-${accent}/10`, `text-${s.color}`, `border-${verdictColor}/30`)
    // nem jelennek meg SZÓ SZERINT a fájlban, ezért a tartalom-alapú szkenner
    // nem találná meg őket — ezek a ténylegesen előforduló szín-token
    // kombinációk (lásd az academyAccentColor, a modulok/skillek 'color'
    // mezője és a 'verdictColor' változók lehetséges értékei).
    { pattern: /^(bg|text|border|ring|hover:bg|hover:text|hover:border|focus:border|focus:ring)-(neon-(cyan|blue|purple|green|red|amber)|amber-400|slate-400)(\/(5|10|15|20|25|30|35|40|45|50|60|70|80|90|100))?$/ }
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          950: '#07090e',
          900: '#0b0e14',
          850: '#10141e',
          800: '#151a26',
          750: '#1c2333',
          700: '#242d42',
          600: '#323f5b'
        },
        neon: {
          cyan: '#00f2fe',
          blue: '#4facfe',
          purple: '#7f00ff',
          green: '#00e676',
          red: '#ff1744',
          amber: '#ffab00'
        }
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace']
      }
    }
  }
}
