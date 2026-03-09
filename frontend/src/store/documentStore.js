/**
 * Document Store
 * Centralized document state management
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

/**
 * Note: To use Zustand, you need to install it first:
 * npm install zustand
 * 
 * This is a placeholder implementation showing the structure.
 * Remove the create import and this store if you don't want to use Zustand.
 */

// Placeholder for now - requires zustand installation
export const useDocumentStore = {
  // This will be implemented once zustand is installed
  // For now, we'll use React Context API instead
};

/**
 * Simple state management using closures (alternative to Zustand)
 */
class DocumentStore {
  constructor() {
    this.documents = [];
    this.selectedDocument = null;
    this.filters = {
      search: '',
      status: 'all',
      sortBy: 'created_at',
      sortOrder: 'desc',
    };
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach((listener) => listener());
  }

  getState() {
    return {
      documents: this.documents,
      selectedDocument: this.selectedDocument,
      filters: this.filters,
    };
  }

  setDocuments(documents) {
    this.documents = documents;
    this.notify();
  }

  addDocument(document) {
    this.documents.unshift(document);
    this.notify();
  }

  updateDocument(id, updates) {
    this.documents = this.documents.map((doc) =>
      doc.id === id ? { ...doc, ...updates } : doc
    );
    if (this.selectedDocument?.id === id) {
      this.selectedDocument = { ...this.selectedDocument, ...updates };
    }
    this.notify();
  }

  deleteDocument(id) {
    this.documents = this.documents.filter((doc) => doc.id !== id);
    if (this.selectedDocument?.id === id) {
      this.selectedDocument = null;
    }
    this.notify();
  }

  setSelectedDocument(document) {
    this.selectedDocument = document;
    this.notify();
  }

  setFilters(filters) {
    this.filters = { ...this.filters, ...filters };
    this.notify();
  }

  resetFilters() {
    this.filters = {
      search: '',
      status: 'all',
      sortBy: 'created_at',
      sortOrder: 'desc',
    };
    this.notify();
  }
}

export const documentStore = new DocumentStore();
