let tailwindConfig = process.env.HUGO_FILE_TAILWIND_CONFIG_JS || './tailwind.config.js';
const tailwind = require('tailwindcss')(tailwindConfig);
const autoprefixer = require('autoprefixer');

module.exports = {
	// eslint-disable-next-line no-process-env
	plugins: [ 
		require('postcss-import'),
		tailwind, 
		require('postcss-flexbugs-fixes'),
		require('postcss-nested'),
		require('postcss-custom-properties'),
		...(process.env.HUGO_ENVIRONMENT === 'production' ? [ autoprefixer ] : [])
	]
};
