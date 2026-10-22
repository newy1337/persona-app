import { api } from './client';

export function getDonors() {
  return api.get('/api/donors');
}

export function createDonor(name) {
  return api.post('/api/donors', { name });
}

export function deleteDonor(id) {
  return api.delete(`/api/donors/${id}`);
}
