module.exports = {
	plugins: [ 
		require('postcss-import'),
		require('tailwindcss')('./tailwind.config.js'),
		require('postcss-nested'),
		// eslint-disable-next-line no-process-env
		...(process.env.HUGO_ENVIRONMENT === 'production' ? [ require('autoprefixer') ] : [])
	]
};
