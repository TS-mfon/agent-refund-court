import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoute, filterCases, buildAgentTask, utf8Length, searchDocs } from '../../web/protocol-model.js';
import { sampleCase, refundedCase, hash } from './sample.js';

test('routes preserve valid deep links and reject malformed case identifiers', () => {
 assert.deepEqual(resolveRoute('/', '?case='+hash('a')), { page:'case', id:hash('a') });
 assert.deepEqual(resolveRoute('/cases/'+hash('b'), ''), { page:'case', id:hash('b') });
 assert.deepEqual(resolveRoute('/cases/../secret', ''), { page:'not-found' });
 assert.deepEqual(resolveRoute('/docs/getting-started', ''), { page:'docs', slug:'getting-started' });
 assert.deepEqual(resolveRoute('/connect', ''), { page:'connect' });
});
test('case filters use published status, committed brief and real receipt values', () => {
 const confirmed=refundedCase(), accepted=sampleCase({id:hash('c'),status:'accepted'});
 assert.equal(filterCases([confirmed,accepted], '', 'refunded').length, 1);
 assert.equal(filterCases([confirmed,accepted], 'tracelite', 'all').length, 2);
 assert.equal(filterCases([confirmed,accepted], hash('9'), 'all')[0]?.id, confirmed.id);
 assert.deepEqual(filterCases([confirmed,accepted], 'unknown project', 'all'), []);
 assert.deepEqual(filterCases([confirmed,accepted], '', 'accepted'), [accepted]);
 const pending={...confirmed,status:'refund_pending' as const,refund:{...confirmed.refund!,verified:false,status:'pending' as const}};
 assert.equal(filterCases([pending], '', 'refunded').length, 0);
});
test('agent task enforces the byte bound and delegates signing to the agent', () => {
 assert.equal(utf8Length('é'), 2);
 const task=buildAgentTask('https://example.com', 'agent-work-v1', 'Write a practical implementation plan.');
 assert.ok(task.includes('agent-work-v1'));
 assert.ok(task.includes('Write a practical implementation plan.'));
 assert.ok(task.includes('Keep wallet signing local'));
 assert.throws(()=>buildAgentTask('https://example.com','agent-work-v1','é'.repeat(601)), /1,200/);
 assert.throws(()=>buildAgentTask('javascript:alert(1)','agent-work-v1','valid task'), /origin/i);
 assert.throws(()=>buildAgentTask('https://example.com','agent-work-v1','   '), /brief/i);
});
test('documentation search includes section text and keeps original articles immutable', () => {
 const articles=[{slug:'start',title:'Get started',summary:'Agent setup',category:'Developers',sections:[{id:'funds',title:'Payment',paragraphs:['USDC on Base Sepolia']}]},{slug:'proof',title:'Receipts',summary:'Evidence',category:'Protocol',sections:[]}];
 assert.deepEqual(searchDocs(articles,'sepolia').map(x=>x.slug),['start']);
 assert.deepEqual(searchDocs(articles,'').map(x=>x.slug),['start','proof']);
 assert.equal(articles.length,2);
});
