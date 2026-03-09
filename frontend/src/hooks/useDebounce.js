import { useEffect, useState } from 'react';

/**
 * useDebounce
 * Returns a debounced value that updates after a delay when the input changes.
 * @param {*} value The input value to debounce
 * @param {number} delay Delay in milliseconds (default 300)
 */
export default function useDebounce(value, delay = 300) {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);

	return debounced;
}
