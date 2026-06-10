import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('fix-issue workflow', () => {
  it('keeps commits workflow-owned after Claude runs', () => {
    const workflow = fs.readFileSync(
      path.join(process.cwd(), '.github/workflows/fix-issue.yml'),
      'utf8',
    );

    assert.doesNotMatch(workflow, /Bash\(git:\*\)/);
    assert.doesNotMatch(workflow, /Bash\(rtk:\*\)/);
    assert.match(workflow, /Bash\(git status:\*\)/);
    assert.match(workflow, /Bash\(git diff:\*\)/);
    assert.match(workflow, /Bash\(git log:\*\)/);
    assert.match(workflow, /Bash\(rtk git status:\*\)/);
    assert.match(workflow, /Bash\(rtk git diff:\*\)/);
    assert.match(workflow, /Bash\(rtk git log:\*\)/);

    const failGateIndex = workflow.indexOf('Fail on Claude soft failure');
    const commitIndex = workflow.indexOf('./.github/actions/commit-and-push');

    assert.ok(failGateIndex > 0);
    assert.ok(commitIndex > failGateIndex);
  });
});
