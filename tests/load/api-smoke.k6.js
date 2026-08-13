/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '20s', target: 10 },
    { duration: '40s', target: 25 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<750'],
  },
};

const baseUrl = __ENV.API_URL || 'http://localhost:4000/api/v1';

export default function () {
  const health = http.get(`${baseUrl}/health`);
  check(health, { 'health returns 200': (response) => response.status === 200 });
  const ready = http.get(`${baseUrl}/ready`);
  check(ready, { 'ready returns 200': (response) => response.status === 200 });
  sleep(1);
}
