const REVIEW_STATE_VERSION = 2;
const TARGET_KIND_VALUES = new Set([
  'review_thread',
  'review_comment',
  'pull_request_review',
  'issue_comment',
]);

function compareNullableStringsAsc(a, b) {
  const left = a ?? '';
  const right = b ?? '';
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareNullableNumbersAsc(a, b) {
  const left = a ?? Number.MAX_SAFE_INTEGER;
  const right = b ?? Number.MAX_SAFE_INTEGER;
  return left - right;
}

function stripReviewFrameworkMarkers(body) {
  if (typeof body !== 'string') {
    return '';
  }
  return body
    .replace(/<!--\s*review-framework:[\s\S]*?-->/g, '')
    .replace(/<!--\s*internal state start\s*-->[\s\S]*?<!--\s*internal state end\s*-->/g, '')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trimEnd();
}

function normalizeReactionGroups(groups) {
  if (!Array.isArray(groups)) {
    return [];
  }
  const normalized = groups.map((group) => {
    const rawTotalCount = group?.users?.totalCount;
    const totalCount = Number.isFinite(rawTotalCount) ? Math.max(0, Math.trunc(rawTotalCount)) : 0;
    return {
      content: String(group?.content ?? ''),
      users: { totalCount },
    };
  });
  normalized.sort((a, b) => {
    if (a.content < b.content) return -1;
    if (a.content > b.content) return 1;
    return 0;
  });
  return normalized;
}

function earliestCommentCreatedAt(comments) {
  if (!Array.isArray(comments) || comments.length === 0) {
    return null;
  }
  let earliest = null;
  for (const comment of comments) {
    if (typeof comment?.createdAt === 'string' && comment.createdAt.length > 0) {
      if (earliest === null || comment.createdAt < earliest) {
        earliest = comment.createdAt;
      }
    }
  }
  return earliest;
}

function sortThreadComments(comments) {
  return [...comments].sort((a, b) => {
    const createdAtOrder = compareNullableStringsAsc(a.createdAt, b.createdAt);
    if (createdAtOrder !== 0) {
      return createdAtOrder;
    }
    return compareNullableStringsAsc(a.nodeId, b.nodeId);
  });
}

function sortReviewThreads(threads) {
  return [...threads].sort((a, b) => {
    const pathOrder = compareNullableStringsAsc(a.path, b.path);
    if (pathOrder !== 0) {
      return pathOrder;
    }
    const startLineOrder = compareNullableNumbersAsc(a.startLine, b.startLine);
    if (startLineOrder !== 0) {
      return startLineOrder;
    }
    const earliestOrder = compareNullableStringsAsc(
      earliestCommentCreatedAt(a.comments),
      earliestCommentCreatedAt(b.comments),
    );
    if (earliestOrder !== 0) {
      return earliestOrder;
    }
    return compareNullableStringsAsc(a.nodeId, b.nodeId);
  });
}

function sortReviews(reviews) {
  return [...reviews].sort((a, b) => {
    const submittedAtOrder = compareNullableStringsAsc(a.submittedAt, b.submittedAt);
    if (submittedAtOrder !== 0) {
      return submittedAtOrder;
    }
    return compareNullableStringsAsc(a.nodeId, b.nodeId);
  });
}

function sortIssueComments(comments) {
  return [...comments].sort((a, b) => {
    const createdAtOrder = compareNullableStringsAsc(a.createdAt, b.createdAt);
    if (createdAtOrder !== 0) {
      return createdAtOrder;
    }
    return compareNullableStringsAsc(a.nodeId, b.nodeId);
  });
}

function normalizeAuthor(author) {
  return {
    login: typeof author?.login === 'string' ? author.login : null,
  };
}

function normalizeBody(body) {
  return stripReviewFrameworkMarkers(body ?? '');
}

function normalizeThreadComment(comment) {
  if (typeof comment?.id !== 'string' || comment.id.length === 0) {
    return null;
  }
  return {
    nodeId: comment.id,
    url: typeof comment.url === 'string' ? comment.url : null,
    author: normalizeAuthor(comment.author),
    createdAt: typeof comment.createdAt === 'string' ? comment.createdAt : null,
    body: normalizeBody(comment.body),
    reactionGroups: normalizeReactionGroups(comment.reactionGroups),
  };
}

function summarizeBody(body, maxLength = 160) {
  if (typeof body !== 'string') {
    return '';
  }
  return body.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeReview(review) {
  if (typeof review?.id !== 'string' || review.id.length === 0) {
    return null;
  }
  const body = normalizeBody(review.body);
  if (body.trim().length === 0) {
    return null;
  }
  return {
    nodeId: review.id,
    url: typeof review.url === 'string' ? review.url : null,
    author: normalizeAuthor(review.author),
    state: typeof review.state === 'string' ? review.state : null,
    submittedAt: typeof review.submittedAt === 'string' ? review.submittedAt : null,
    body,
    reactionGroups: normalizeReactionGroups(review.reactionGroups),
  };
}

function isActionableReview(review) {
  return review.state === 'CHANGES_REQUESTED' || review.state === 'COMMENTED';
}

function normalizeIssueComment(comment) {
  if (typeof comment?.id !== 'string' || comment.id.length === 0) {
    return null;
  }
  const body = normalizeBody(comment.body);
  if (body.trim().length === 0) {
    return null;
  }
  return {
    nodeId: comment.id,
    url: typeof comment.url === 'string' ? comment.url : null,
    author: normalizeAuthor(comment.author),
    createdAt: typeof comment.createdAt === 'string' ? comment.createdAt : null,
    body,
    reactionGroups: normalizeReactionGroups(comment.reactionGroups),
    replies: [],
  };
}

function normalizeReviewStateV2(input) {
  const normalizedThreads = [];
  const threadCandidates = Array.isArray(input?.reviewThreads) ? input.reviewThreads : [];
  for (const thread of threadCandidates) {
    if (thread?.isResolved !== false) continue;
    if (typeof thread?.id !== 'string' || thread.id.length === 0) continue;

    const normalizedComments = [];
    const commentCandidates = Array.isArray(thread?.comments?.nodes) ? thread.comments.nodes : [];
    for (const comment of commentCandidates) {
      const normalizedComment = normalizeThreadComment(comment);
      if (normalizedComment) normalizedComments.push(normalizedComment);
    }

    const sortedComments = sortThreadComments(normalizedComments);
    const primaryComment = sortedComments[0] ?? null;
    if (primaryComment === null) continue;
    const startLine =
      Number.isInteger(thread.startLine) && thread.startLine >= 0
        ? thread.startLine
        : Number.isInteger(thread.originalStartLine) && thread.originalStartLine >= 0
          ? thread.originalStartLine
          : null;
    const endLine =
      Number.isInteger(thread.line) && thread.line >= 0
        ? thread.line
        : Number.isInteger(thread.originalLine) && thread.originalLine >= 0
          ? thread.originalLine
          : null;

    normalizedThreads.push({
      threadKey: `review_thread:${thread.id}`,
      nodeId: thread.id,
      isResolved: false,
      isOutdated: Boolean(thread.isOutdated),
      path: typeof thread.path === 'string' ? thread.path : null,
      startLine,
      endLine,
      ordering: {
        path: typeof thread.path === 'string' ? thread.path : null,
        startLine,
        earliestCommentCreatedAt: earliestCommentCreatedAt(sortedComments),
        nodeId: thread.id,
      },
      primaryComment: {
        nodeId: primaryComment.nodeId,
        url: primaryComment.url,
        authorLogin: primaryComment.author.login,
        createdAt: primaryComment.createdAt,
        bodySnippet: summarizeBody(primaryComment.body),
      },
      targetHint: {
        kind: 'review_thread',
        nodeId: thread.id,
        url: primaryComment.url,
      },
      isActionableCandidate: !thread.isOutdated,
      comments: sortedComments,
    });
  }

  const normalizedReviews = [];
  const reviewCandidates = Array.isArray(input?.reviews) ? input.reviews : [];
  for (const review of reviewCandidates) {
    const normalizedReview = normalizeReview(review);
    if (normalizedReview) normalizedReviews.push(normalizedReview);
  }

  const normalizedIssueComments = [];
  const issueCommentCandidates = Array.isArray(input?.issueComments) ? input.issueComments : [];
  for (const issueComment of issueCommentCandidates) {
    const normalizedComment = normalizeIssueComment(issueComment);
    if (normalizedComment) normalizedIssueComments.push(normalizedComment);
  }

  const reviewThreads = sortReviewThreads(normalizedThreads);
  const sortedReviews = sortReviews(normalizedReviews);
  const sortedIssueComments = sortIssueComments(normalizedIssueComments);
  const threadTargets = reviewThreads.map((thread) => ({
    targetKey: thread.threadKey,
    kind: 'review_thread',
    nodeId: thread.nodeId,
    url: thread.targetHint.url,
    threadNodeId: thread.nodeId,
    path: thread.path,
    startLine: thread.startLine,
    endLine: thread.endLine,
    isOutdated: thread.isOutdated,
    isActionableCandidate: thread.isActionableCandidate,
    primaryCommentNodeId: thread.primaryComment?.nodeId ?? null,
    primaryCommentAuthorLogin: thread.primaryComment?.authorLogin ?? null,
    primaryCommentCreatedAt: thread.primaryComment?.createdAt ?? null,
  }));
  const reviewTargets = sortedReviews.map((review) => ({
    targetKey: `pull_request_review:${review.nodeId}`,
    kind: 'pull_request_review',
    nodeId: review.nodeId,
    url: review.url,
    path: null,
    startLine: null,
    endLine: null,
    isOutdated: false,
    isActionableCandidate: isActionableReview(review),
    primaryCommentNodeId: review.nodeId,
    primaryCommentAuthorLogin: review.author.login,
    primaryCommentCreatedAt: review.submittedAt,
  }));
  const issueCommentTargets = sortedIssueComments.map((comment) => ({
    targetKey: `issue_comment:${comment.nodeId}`,
    kind: 'issue_comment',
    nodeId: comment.nodeId,
    url: comment.url,
    path: null,
    startLine: null,
    endLine: null,
    isOutdated: false,
    isActionableCandidate: true,
    primaryCommentNodeId: comment.nodeId,
    primaryCommentAuthorLogin: comment.author.login,
    primaryCommentCreatedAt: comment.createdAt,
  }));

  return {
    version: REVIEW_STATE_VERSION,
    fetchedAt: String(input?.fetchedAt ?? ''),
    sourceBranch: typeof input?.sourceBranch === 'string' ? input.sourceBranch : null,
    pr: {
      url: typeof input?.pr?.url === 'string' ? input.pr.url : null,
      nodeId: typeof input?.pr?.id === 'string' ? input.pr.id : null,
      number: Number.isInteger(input?.pr?.number) ? input.pr.number : null,
      title: typeof input?.pr?.title === 'string' ? input.pr.title : null,
      state: typeof input?.pr?.state === 'string' ? input.pr.state : null,
      headRefName: typeof input?.pr?.headRefName === 'string' ? input.pr.headRefName : null,
      baseRefName: typeof input?.pr?.baseRefName === 'string' ? input.pr.baseRefName : null,
      updatedAt: typeof input?.pr?.updatedAt === 'string' ? input.pr.updatedAt : null,
    },
    reviewThreads,
    targets: [...threadTargets, ...reviewTargets, ...issueCommentTargets],
    reviews: sortedReviews,
    issueComments: sortedIssueComments,
  };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function validateReactionGroupShape(group, pointer) {
  if (!isNonEmptyString(group?.content)) {
    throw new TypeError(`${pointer}.content must be a non-empty string`);
  }
  if (!Number.isInteger(group?.users?.totalCount) || group.users.totalCount < 0) {
    throw new TypeError(`${pointer}.users.totalCount must be a non-negative integer`);
  }
}

function validateBodyEntryShape(entry, pointer) {
  if (!isNonEmptyString(entry?.nodeId)) {
    throw new TypeError(`${pointer}.nodeId must be a non-empty string`);
  }
  if (entry.url !== null && entry.url !== undefined && typeof entry.url !== 'string') {
    throw new TypeError(`${pointer}.url must be string or null`);
  }
  if (typeof entry?.author !== 'object' || entry.author === null) {
    throw new TypeError(`${pointer}.author must be an object`);
  }
  if (
    entry.author.login !== null &&
    entry.author.login !== undefined &&
    typeof entry.author.login !== 'string'
  ) {
    throw new TypeError(`${pointer}.author.login must be string or null`);
  }
  if (
    entry.createdAt !== null &&
    entry.createdAt !== undefined &&
    typeof entry.createdAt !== 'string'
  ) {
    throw new TypeError(`${pointer}.createdAt must be string or null`);
  }
  if (typeof entry.body !== 'string') {
    throw new TypeError(`${pointer}.body must be a string`);
  }
  if (!Array.isArray(entry.reactionGroups)) {
    throw new TypeError(`${pointer}.reactionGroups must be an array`);
  }
  for (let index = 0; index < entry.reactionGroups.length; index += 1) {
    validateReactionGroupShape(entry.reactionGroups[index], `${pointer}.reactionGroups[${index}]`);
  }
}

function validateReviewBodyShape(entry, pointer) {
  if (typeof entry !== 'object' || entry === null) {
    throw new TypeError(`${pointer} must be an object`);
  }
  if (!isNonEmptyString(entry.nodeId)) {
    throw new TypeError(`${pointer}.nodeId must be a non-empty string`);
  }
  if (typeof entry.author !== 'object' || entry.author === null) {
    throw new TypeError(`${pointer}.author must be an object`);
  }
  if (
    entry.author.login !== null &&
    entry.author.login !== undefined &&
    typeof entry.author.login !== 'string'
  ) {
    throw new TypeError(`${pointer}.author.login must be string or null`);
  }
  if (!isNonEmptyString(entry.body)) {
    throw new TypeError(`${pointer}.body must be a non-empty string`);
  }
  if (!Array.isArray(entry.reactionGroups)) {
    throw new TypeError(`${pointer}.reactionGroups must be an array`);
  }
  for (let index = 0; index < entry.reactionGroups.length; index += 1) {
    validateReactionGroupShape(entry.reactionGroups[index], `${pointer}.reactionGroups[${index}]`);
  }
}

function validateIssueCommentShape(entry, pointer) {
  validateReviewBodyShape(entry, pointer);
  if (!Array.isArray(entry.replies)) {
    throw new TypeError(`${pointer}.replies must be an array`);
  }
}

function assertReviewStateV2(reviewState) {
  if (typeof reviewState !== 'object' || reviewState === null) {
    throw new TypeError('review-state must be an object');
  }
  if (reviewState.version !== REVIEW_STATE_VERSION) {
    throw new TypeError(`review-state version must be ${REVIEW_STATE_VERSION}`);
  }
  if (!isNonEmptyString(reviewState.fetchedAt)) {
    throw new TypeError('review-state fetchedAt must be a non-empty string');
  }

  const pr = reviewState.pr;
  if (typeof pr !== 'object' || pr === null) {
    throw new TypeError('review-state pr must be an object');
  }
  if (!isNonEmptyString(pr.nodeId)) {
    throw new TypeError('review-state pr.nodeId must be a non-empty string');
  }
  if (!Array.isArray(reviewState.reviewThreads)) {
    throw new TypeError('review-state reviewThreads must be an array');
  }
  for (let index = 0; index < reviewState.reviewThreads.length; index += 1) {
    const thread = reviewState.reviewThreads[index];
    const pointer = `review-state reviewThreads[${index}]`;
    if (!isNonEmptyString(thread?.threadKey)) {
      throw new TypeError(`${pointer}.threadKey must be a non-empty string`);
    }
    if (!isNonEmptyString(thread?.nodeId)) {
      throw new TypeError(`${pointer}.nodeId must be a non-empty string`);
    }
    if (thread?.isResolved !== false) {
      throw new TypeError(`${pointer}.isResolved must be false`);
    }
    if (typeof thread?.ordering !== 'object' || thread.ordering === null) {
      throw new TypeError(`${pointer}.ordering must be an object`);
    }
    if (thread?.targetHint?.kind !== 'review_thread') {
      throw new TypeError(`${pointer}.targetHint.kind must be review_thread`);
    }
    if (!isNonEmptyString(thread?.targetHint?.nodeId)) {
      throw new TypeError(`${pointer}.targetHint.nodeId must be a non-empty string`);
    }
    if (typeof thread?.isActionableCandidate !== 'boolean') {
      throw new TypeError(`${pointer}.isActionableCandidate must be a boolean`);
    }
    if (!Array.isArray(thread.comments)) {
      throw new TypeError(`${pointer}.comments must be an array`);
    }
    for (let commentIndex = 0; commentIndex < thread.comments.length; commentIndex += 1) {
      validateBodyEntryShape(thread.comments[commentIndex], `${pointer}.comments[${commentIndex}]`);
    }
  }
  if (!Array.isArray(reviewState.reviews)) {
    throw new TypeError('review-state reviews must be an array');
  }
  for (let index = 0; index < reviewState.reviews.length; index += 1) {
    validateReviewBodyShape(reviewState.reviews[index], `review-state reviews[${index}]`);
  }
  if (!Array.isArray(reviewState.issueComments)) {
    throw new TypeError('review-state issueComments must be an array');
  }
  for (let index = 0; index < reviewState.issueComments.length; index += 1) {
    validateIssueCommentShape(
      reviewState.issueComments[index],
      `review-state issueComments[${index}]`,
    );
  }
  if (!Array.isArray(reviewState.targets)) {
    throw new TypeError('review-state targets must be an array');
  }
  for (let index = 0; index < reviewState.targets.length; index += 1) {
    const target = reviewState.targets[index];
    const pointer = `review-state targets[${index}]`;
    if (!isNonEmptyString(target?.targetKey)) {
      throw new TypeError(`${pointer}.targetKey must be a non-empty string`);
    }
    if (!TARGET_KIND_VALUES.has(target?.kind)) {
      throw new TypeError(`${pointer}.kind must be a supported target kind`);
    }
    if (!isNonEmptyString(target?.nodeId)) {
      throw new TypeError(`${pointer}.nodeId must be a non-empty string`);
    }
  }
  return reviewState;
}

function formatCanonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export {
  assertReviewStateV2,
  formatCanonicalJson,
  normalizeReviewStateV2,
  REVIEW_STATE_VERSION,
  stripReviewFrameworkMarkers,
};
