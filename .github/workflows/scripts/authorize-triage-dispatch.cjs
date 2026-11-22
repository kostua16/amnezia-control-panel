// eslint-disable-next-line @typescript-eslint/no-require-imports -- Load the shared JSON policy from this CommonJS script.
const policy = require('../policy.json');

function isAuthorizedTriageAuthor(association, type, login) {
  return (
    policy.maintainerAssociations.includes(association) ||
    (type === 'Bot' && policy.trustedTriageBotLogins.includes(login))
  );
}

if (require.main === module) {
  const { AUTHOR_ASSOCIATION, AUTHOR_TYPE, AUTHOR_LOGIN } = process.env;
  process.stdout.write(
    String(
      isAuthorizedTriageAuthor(AUTHOR_ASSOCIATION, AUTHOR_TYPE, AUTHOR_LOGIN),
    ),
  );
}

module.exports = { isAuthorizedTriageAuthor };
