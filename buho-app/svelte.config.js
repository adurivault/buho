import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			fallback: 'index.html'
		}),
		paths: {
			base: '/buho'
		}
	},

	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
};

export default config;
