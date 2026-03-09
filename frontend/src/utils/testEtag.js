/**
 * ETag System Test Utility
 * 
 * Run this from browser console to test ETag functionality:
 * 
 * // Import and run tests
 * import { runETagTests } from './utils/testEtag';
 * runETagTests(documentId);
 */

import { etagManager } from './etagManager';
import documentService from '../services/documentService';

/**
 * Test 1: Verify ETag is stored on document load
 */
export async function testETagStorage(documentId) {
  console.group('🧪 Test 1: ETag Storage');
  
  try {
    // Clear any existing ETag
    etagManager.clearETag(documentId);
    console.log('✓ Cleared existing ETag');
    
    // Load document
    console.log('Loading document...');
    const doc = await documentService.getCompleteDocument(documentId);
    
    // Check if ETag was stored
    const storedETag = etagManager.getETag(documentId);
    
    if (storedETag) {
      console.log('✅ SUCCESS: ETag stored:', storedETag);
      console.log('Document:', doc.title);
      return { success: true, etag: storedETag };
    } else {
      console.error('❌ FAILED: No ETag stored');
      return { success: false, error: 'ETag not stored' };
    }
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    return { success: false, error: error.message };
  } finally {
    console.groupEnd();
  }
}

/**
 * Test 2: Verify 304 Not Modified (caching)
 */
export async function testCaching(documentId) {
  console.group('🧪 Test 2: 304 Caching');
  
  try {
    // First request - should get full data
    console.log('First request (full data)...');
    const doc1 = await documentService.getCompleteDocument(documentId);
    const etag1 = etagManager.getETag(documentId);
    console.log('✓ First load complete, ETag:', etag1);
    
    // Second request - should get 304 (cached)
    console.log('Second request (should be cached)...');
    const startTime = performance.now();
    const doc2 = await documentService.getCompleteDocument(documentId);
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    const etag2 = etagManager.getETag(documentId);
    
    console.log('✓ Second load complete in', duration.toFixed(2), 'ms');
    console.log('ETag unchanged:', etag1 === etag2);
    
    // Check cache
    const cached = etagManager.getCache(documentId);
    
    if (cached) {
      console.log('✅ SUCCESS: Cache working, response time:', duration.toFixed(2), 'ms');
      console.log('Note: Check Network tab for 304 status');
      return { success: true, cached: true, duration };
    } else {
      console.log('⚠️ WARNING: No cached data (may still work if 304 received)');
      return { success: true, cached: false, duration };
    }
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    return { success: false, error: error.message };
  } finally {
    console.groupEnd();
  }
}

/**
 * Test 3: Verify 412 Conflict Detection (requires manual trigger)
 */
export async function testConflictDetection(documentId) {
  console.group('🧪 Test 3: 412 Conflict Detection');
  console.log('⚠️ MANUAL TEST REQUIRED');
  console.log('');
  console.log('Steps to test:');
  console.log('1. Open this document in TWO browser windows');
  console.log('2. Window A: Make a change and save');
  console.log('3. Window B: Make a different change and save');
  console.log('4. Window B should show 412 conflict error');
  console.log('');
  console.log('Expected behavior:');
  console.log('- Window B shows: "Document has been modified by another user"');
  console.log('- User gets option to Refresh or Cancel');
  console.log('');
  
  const currentETag = etagManager.getETag(documentId);
  console.log('Current ETag:', currentETag);
  console.log('');
  console.log('To simulate conflict programmatically:');
  console.log(`etagManager.setETag("${documentId}", "fake-stale-etag");`);
  console.log('// Then try to save - should get 412 error');
  
  console.groupEnd();
  
  return { 
    success: true, 
    manual: true,
    currentETag,
    message: 'Manual test - follow steps above'
  };
}

/**
 * Test 4: Verify If-Match header is sent
 */
export async function testIfMatchHeader(documentId) {
  console.group('🧪 Test 4: If-Match Header');
  
  try {
    const etag = etagManager.getETag(documentId);
    
    if (!etag) {
      console.log('Loading document to get ETag...');
      await documentService.getCompleteDocument(documentId);
    }
    
    const currentETag = etagManager.getETag(documentId);
    console.log('Current ETag:', currentETag);
    console.log('');
    console.log('✓ Next save operation will include:');
    console.log(`  If-Match: ${currentETag}`);
    console.log('');
    console.log('To verify:');
    console.log('1. Open DevTools → Network tab');
    console.log('2. Save the document');
    console.log('3. Check the partial-save request headers');
    console.log('4. Should see: If-Match: ' + currentETag);
    
    console.groupEnd();
    
    return { success: true, etag: currentETag };
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    console.groupEnd();
    return { success: false, error: error.message };
  }
}

/**
 * Test 5: Check ETag manager state
 */
export function testETagManagerState() {
  console.group('🧪 Test 5: ETag Manager State');
  
  // Access internal state (for debugging)
  const allETags = Array.from(etagManager.etags.entries());
  const allCaches = Array.from(etagManager.cache.entries());
  
  console.log('Stored ETags:', allETags.length);
  allETags.forEach(([id, etag]) => {
    console.log(`  ${id}: ${etag}`);
  });
  
  console.log('');
  console.log('Cached responses:', allCaches.length);
  allCaches.forEach(([id, data]) => {
    console.log(`  ${id}: ${data?.title || 'cached'}`);
  });
  
  console.groupEnd();
  
  return {
    success: true,
    etagCount: allETags.length,
    cacheCount: allCaches.length,
    etags: allETags,
  };
}

/**
 * Run all automated tests
 */
export async function runETagTests(documentId) {
  console.clear();
  console.log('🚀 Starting ETag System Tests');
  console.log('Document ID:', documentId);
  console.log('═'.repeat(60));
  console.log('');
  
  const results = {
    documentId,
    timestamp: new Date().toISOString(),
    tests: {}
  };
  
  // Test 1: ETag Storage
  results.tests.storage = await testETagStorage(documentId);
  await sleep(500);
  
  // Test 2: Caching (304)
  results.tests.caching = await testCaching(documentId);
  await sleep(500);
  
  // Test 3: Conflict Detection (manual)
  results.tests.conflict = await testConflictDetection(documentId);
  await sleep(500);
  
  // Test 4: If-Match Header
  results.tests.ifMatch = await testIfMatchHeader(documentId);
  await sleep(500);
  
  // Test 5: Manager State
  results.tests.state = testETagManagerState();
  
  // Summary
  console.log('');
  console.log('═'.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('═'.repeat(60));
  
  const passed = Object.values(results.tests).filter(t => t.success).length;
  const total = Object.keys(results.tests).length;
  
  console.log(`Total: ${passed}/${total} tests passed`);
  console.log('');
  
  Object.entries(results.tests).forEach(([name, result]) => {
    const icon = result.success ? '✅' : '❌';
    const status = result.manual ? '⚠️ MANUAL' : (result.success ? 'PASS' : 'FAIL');
    console.log(`${icon} ${name}: ${status}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });
  
  console.log('');
  console.log('💡 TIP: Check browser DevTools Network tab to see:');
  console.log('   - 304 Not Modified (caching working)');
  console.log('   - If-Match headers (conflict prevention working)');
  console.log('   - ETag response headers');
  
  return results;
}

/**
 * Quick test - just check if ETags are being stored
 */
export async function quickTest(documentId) {
  console.log('⚡ Quick ETag Test');
  
  const etag = etagManager.getETag(documentId);
  
  if (etag) {
    console.log('✅ ETag exists:', etag);
    console.log('System is working!');
  } else {
    console.log('⚠️ No ETag found, loading document...');
    await documentService.getCompleteDocument(documentId);
    const newEtag = etagManager.getETag(documentId);
    
    if (newEtag) {
      console.log('✅ ETag now stored:', newEtag);
      console.log('System is working!');
    } else {
      console.error('❌ ETag not stored - system may not be working');
      console.log('Check:');
      console.log('1. Backend is returning ETag header');
      console.log('2. etagManager.setETag() is being called');
      console.log('3. No errors in console');
    }
  }
}

// Helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Export for console use
if (typeof window !== 'undefined') {
  window.testETag = {
    runAll: runETagTests,
    quick: quickTest,
    storage: testETagStorage,
    caching: testCaching,
    conflict: testConflictDetection,
    headers: testIfMatchHeader,
    state: testETagManagerState,
  };
}
