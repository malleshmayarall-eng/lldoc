import { useState, useCallback } from 'react';

/**
 * Custom hook for API calls with loading and error states
 * @returns {object} - API state and execute function
 */
export const useApi = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Execute API call
   * @param {function} apiFunc - API function to execute
   * @param {*} params - Parameters to pass to API function
   * @returns {Promise} - API response
   */
  const execute = useCallback(async (apiFunc, ...params) => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await apiFunc(...params);
      setData(response.data);
      
      return response;
    } catch (err) {
      const errorMessage = err.response?.data?.message || err.message || 'An error occurred';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    setData(null);
    setLoading(false);
    setError(null);
  }, []);

  return {
    data,
    loading,
    error,
    execute,
    reset,
  };
};
