const Twitter = require('twitter');
const https = require('https');

const twitterClient = new Twitter({
  consumer_key: process.env.API_KEY,
  consumer_secret: process.env.API_SECRET,
  access_token_key: process.env.ACCESS_TOKEN,
  access_token_secret: process.env.ACCESS_TOKEN_SECRET,
});

const TARGET_HASHTAG = process.env.TARGET_HASHTAG || 'til';

const githubAuthorBase = {
  name: process.env.GITHUB_USER,
  email: process.env.GITHUB_EMAIL,
};

const githubBasicToken = Buffer.from(process.env.GITHUB_USER + ':' + process.env.GITHUB_TOKEN).toString('base64');

const githubApiBaseOptions = {
  hostname: 'api.github.com',
  port: 443,
  headers: {
    Authorization: `Basic ${githubBasicToken}`,
    'User-Agent': 'halnique',
  },
};

const githubApiGetRefsHeadsOptions = {
  ...githubApiBaseOptions,
  method: 'GET',
  path: '/repos/halnique/til-twitter/git/refs/heads/master',
};

const githubApiGetCommitsOptions = {
  ...githubApiBaseOptions,
  method: 'GET',
  path: '/repos/halnique/til-twitter/git/commits',
};

const githubApiPostBlobsOptions = {
  ...githubApiBaseOptions,
  method: 'POST',
  path: '/repos/halnique/til-twitter/git/blobs',
  'Content-Type': 'application/json',
};

const githubApiPostTreesOptions = {
  ...githubApiBaseOptions,
  method: 'POST',
  path: '/repos/halnique/til-twitter/git/trees',
  'Content-Type': 'application/json',
};

const githubApiPostCommitsOptions = {
  ...githubApiBaseOptions,
  method: 'POST',
  path: '/repos/halnique/til-twitter/git/commits',
};

const githubApiPatchRefsHeadsOptions = {
  ...githubApiBaseOptions,
  method: 'PATCH',
  path: '/repos/halnique/til-twitter/git/refs/heads/master',
};

let now;

/**
 * @returns {Promise<[]>}
 */
const getTweets = async () => {
  const nowString = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate() - 1}`;
  const params = {
    q: `(from:${process.env.ACCOUNT_NAME}) since:${nowString} ${TARGET_HASHTAG}`,
    count: process.env.MAX_COUNT || 5,
  };

  const tweets = await twitterClient.get('search/tweets', params).catch(() => []);
  if (tweets.statuses.length === 0) return [];

  const targetTweets = tweets.statuses.filter(tweet => {
    const hashtags = tweet.entities.hashtags;
    if (hashtags.length === 0) return;

    const hasTargetHashtag = hashtags.filter(hashtag => hashtag.text === TARGET_HASHTAG).length > 0;
    if (!hasTargetHashtag) return;

    return tweet;
  }).map(tweet => tweet.text);
  if (targetTweets.length === 0) return [];

  return targetTweets;
};

/**
 * @param {array} data
 * @returns {Promise<void>}
 */
const postTil = async (data) => {
  for (let i = 0; i < data.length; i++) {
    const prevRefsHead = await getRefsHead();
    const commitSha = prevRefsHead.object.sha;
    const prevCommit = await getCommit(commitSha);
    const blob = await postBlob(data[i]);
    const tree = await postTree(prevCommit.tree.sha, blob.sha, i + 1);
    const commit = await postCommit(commitSha, tree.sha, i + 1);
    await patchRefsHead(commit.sha);
    await sleep(1);
  }
};

const getRefsHead = async () => {
  return await get(githubApiGetRefsHeadsOptions);
};

const getCommit = async (sha) => {
  return await get({
    ...githubApiGetCommitsOptions,
    path: `${githubApiGetCommitsOptions.path}/${sha}`
  });
};

const postBlob = async (content) => {
  return await post(githubApiPostBlobsOptions, JSON.stringify({
    content: content,
    encoding: "utf-8",
  }));
};

const postTree = async (baseTreeSha, blobSha, number) => {
  return await post(githubApiPostTreesOptions, JSON.stringify({
    base_tree: baseTreeSha,
    tree: [
      {
        path: `til/${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}/${number}.txt`,
        mode: '100644',
        type: 'blob',
        sha: blobSha,
      }
    ],
  }));
};

const postCommit = async (parentCommitSha, treeSha, number) => {
  return await post(githubApiPostCommitsOptions, JSON.stringify({
    message: `${TARGET_HASHTAG} ${number}`,
    author: {
      ...githubAuthorBase,
      date: now.toISOString(),
    },
    parents: [
      parentCommitSha,
    ],
    tree: treeSha,
  }));
};

const patchRefsHead = async (commitSha) => {
  return await post(githubApiPatchRefsHeadsOptions, JSON.stringify({
    sha: commitSha,
    force: false,
  }));
};

const get = async (options) => {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (d) => {
        data += d;
      });
      res.on('end', () => {
        data = JSON.parse(data);
        resolve(data);
      });
    });
    req.on('error', (error) => {
      reject(error)
    });
    req.end();
  });
};

const post = async (options, body) => {
  return new Promise((resolve, reject) => {
    const req = https.request({
      ...options,
      'Content-Length': body.length,
    }, (res) => {
      let data = '';
      res.on('data', (d) => {
        data += d;
      });
      res.on('end', () => {
        data = JSON.parse(data);
        resolve(data);
      });
    });
    req.on('error', (error) => {
      reject(error)
    });
    req.write(body);
    req.end();
  });
};

const sleep = async (sec) => {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, sec * 1000);
  });
};

const handler = async () => {
  now = new Date();

  const tweets = await getTweets();
  if (tweets.length === 0) return response();

  await postTil(tweets);

  return response();
};

const response = () => {
  return {
    statusCode: 200,
  };
};

exports.handler = handler;
