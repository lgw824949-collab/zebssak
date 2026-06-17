import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        muted: 'var(--muted-foreground)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        'zeb-2xs': ['var(--font-size-2xs)', { lineHeight: '1.3' }],
        'zeb-xs': ['var(--font-size-xs)', { lineHeight: '1.45', letterSpacing: '-0.01em' }],
        'zeb-sm': ['var(--font-size-sm)', { lineHeight: '1.5', letterSpacing: '-0.02em' }],
        'zeb-base': ['var(--font-size-base)', { lineHeight: '1.55', letterSpacing: '-0.02em' }],
        'zeb-md': ['var(--font-size-md)', { lineHeight: '1.55', letterSpacing: '-0.02em' }],
        'zeb-lg': ['var(--font-size-lg)', { lineHeight: '1.5', letterSpacing: '-0.02em' }],
        'zeb-xl': ['var(--font-size-xl)', { lineHeight: '1.4', letterSpacing: '-0.03em' }],
        'zeb-2xl': ['var(--font-size-2xl)', { lineHeight: '1.35', letterSpacing: '-0.03em' }],
        'zeb-3xl': ['var(--font-size-3xl)', { lineHeight: '1.3', letterSpacing: '-0.03em' }],
      },
    },
  },
  plugins: [],
}
export default config
