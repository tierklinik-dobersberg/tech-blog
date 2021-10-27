const theme = require('tailwindcss/defaultTheme');
const colors = require('tailwindcss/colors')
const typography = require('@tailwindcss/typography');

module.exports = {
	important: true, // See https://tailwindcss.com/docs/configuration#important
	darkMode: 'media',
	theme: {
		extend: {
			screens: {
				'dark-mode': { 'raw': '(prefers-color-scheme: dark)' },
			},
			colors: {
				'light-blue': colors.lightBlue,
				cyan: colors.cyan,
			},
			typography: (theme) => ({
				light: {
					css: [
						{
							color: theme('colors.gray.400'),
							'[class~="lead"]': {
								color: theme('colors.gray.300'),
							},
							a: {
								color: theme('colors.white'),
							},
							strong: {
								color: theme('colors.white'),
							},
							'ol > li::before': {
								color: theme('colors.gray.400'),
							},
							'ul > li::before': {
								backgroundColor: theme('colors.gray.600'),
							},
							hr: {
								borderColor: theme('colors.gray.200'),
							},
							blockquote: {
								color: theme('colors.gray.200'),
								borderLeftColor: theme('colors.gray.600'),
							},
							h1: {
								color: theme('colors.white'),
							},
							h2: {
								color: theme('colors.white'),
							},
							h3: {
								color: theme('colors.white'),
							},
							h4: {
								color: theme('colors.white'),
							},
							'figure figcaption': {
								color: theme('colors.gray.400'),
							},
							code: {
								color: theme('colors.white'),
							},
							'a code': {
								color: theme('colors.white'),
							},
							pre: {
								color: theme('colors.gray.200'),
								backgroundColor: theme('colors.gray.800'),
							},
							thead: {
								color: theme('colors.white'),
								borderBottomColor: theme('colors.gray.400'),
							},
							'tbody tr': {
								borderBottomColor: theme('colors.gray.600'),
							},
						},
					],
				},
			}),
		},
	},
	purge: {
		enabled: process.env.HUGO_ENVIRONMENT === 'production',
		content: [
			'./hugo_stats.json',
			'./layouts/**/*.html',
		],
		extractors: [
			{
				extractor: (content) => {
					let els = JSON.parse(content).htmlElements;
					return els.tags.concat(els.classes, els.ids);
				},
				extensions: ['json']
			},
		],
		mode: 'all',

	},
	variants: {
		extend: {
			typography: ['dark'],
		},
	},
	plugins: [typography]
};
