/**
 * Test Alignment API - Standalone test to verify backend is working
 * Run this in browser console: testAlignment(imageId)
 */

import inlineImageService from '../services/paragraphs/inlineImageService';

export const testAlignment = async (imageId) => {
  console.log('🧪 TESTING ALIGNMENT API');
  console.log('Image ID:', imageId);
  
  // Test 1: Set to LEFT
  console.log('\n--- TEST 1: Set to LEFT ---');
  try {
    const result1 = await inlineImageService.updateAlignment(imageId, 'left');
    console.log('✅ LEFT worked:', result1);
  } catch (err) {
    console.error('❌ LEFT failed:', err.response?.data || err.message);
  }
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 2: Set to CENTER
  console.log('\n--- TEST 2: Set to CENTER ---');
  try {
    const result2 = await inlineImageService.updateAlignment(imageId, 'center');
    console.log('✅ CENTER worked:', result2);
  } catch (err) {
    console.error('❌ CENTER failed:', err.response?.data || err.message);
  }
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 3: Set to RIGHT
  console.log('\n--- TEST 3: Set to RIGHT ---');
  try {
    const result3 = await inlineImageService.updateAlignment(imageId, 'right');
    console.log('✅ RIGHT worked:', result3);
  } catch (err) {
    console.error('❌ RIGHT failed:', err.response?.data || err.message);
  }
  
  console.log('\n🧪 TEST COMPLETE');
};

// Make it available globally for console testing
if (typeof window !== 'undefined') {
  window.testAlignment = testAlignment;
}

export default testAlignment;
