// 実 API を叩くスモークテスト（Playwright には拾わせない: *.spec.ts ではない）。
// 起動中のサーバー（既定 http://localhost:3000/api/parse/、TEST_URL で変更）に本物の OPENAI_API_KEY が要る。
// gpt-4o-mini の読み取り精度を確認する用途。決定的な検証は tests/integration/api-parse.test.ts と tests/e2e/chat-import.spec.ts。
// 実行: npm run test:parse
import process from 'node:process';

const API_URL = process.env.TEST_URL || 'http://localhost:3000/api/parse/';

const cases = [
  {
    name: '正常系',
    input: '今日19時に三条集合ー\n田中: 行きます！鞍馬から向かいます\n佐藤: 私も行く 桂です',
    validate: (data) => {
      if (data.venue !== '三条') throw new Error(`venue mismatch: ${data.venue}`);
      if (data.meetAt !== '19:00') throw new Error(`meetAt mismatch: ${data.meetAt}`);
      if (!Array.isArray(data.members) || data.members.length !== 2) {
        throw new Error(`members length mismatch: ${JSON.stringify(data.members)}`);
      }
      if (data.members[0].name !== '田中' || data.members[0].station !== '鞍馬') {
        throw new Error(`first member mismatch: ${JSON.stringify(data.members[0])}`);
      }
      if (data.members[1].name !== '佐藤' || data.members[1].station !== '桂') {
        throw new Error(`second member mismatch: ${JSON.stringify(data.members[1])}`);
      }
    },
  },
  {
    name: '空入力',
    input: '',
    expectedStatus: 400,
    validate: (data) => {
      if (data.error !== 'LINEの会話を貼り付けてください') {
        throw new Error(`empty input error mismatch: ${JSON.stringify(data)}`);
      }
    },
  },
  {
    name: '時刻なし',
    input: '三条集合ー\n田中: 行きます！鞍馬から向かいます\n佐藤: 私も行く 桂です',
    validate: (data) => {
      if (data.venue !== '三条') throw new Error(`venue mismatch: ${data.venue}`);
      if (data.meetAt !== null) throw new Error(`meetAt should be null: ${data.meetAt}`);
      if (!Array.isArray(data.members) || data.members.length !== 2) {
        throw new Error(`members length mismatch: ${JSON.stringify(data.members)}`);
      }
    },
  },
  {
    name: '駅なし',
    input: '今日19時に三条集合ー\n田中: 行きます\n佐藤: 私も行く',
    validate: (data) => {
      if (data.venue !== '三条') throw new Error(`venue mismatch: ${data.venue}`);
      if (data.meetAt !== '19:00') throw new Error(`meetAt mismatch: ${data.meetAt}`);
      if (!Array.isArray(data.members) || data.members.length !== 0) {
        throw new Error(`members should be empty array: ${JSON.stringify(data.members)}`);
      }
    },
  },
  {
    name: '四条と駅付き1人',
    input: '19時に四条\n田中: 行きます\n佐藤: 桂から行く',
    validate: (data) => {
      if (data.venue !== '四条') throw new Error(`venue mismatch: ${data.venue}`);
      if (data.meetAt !== '19:00') throw new Error(`meetAt mismatch: ${data.meetAt}`);
      if (!Array.isArray(data.members) || data.members.length !== 1) {
        throw new Error(`members length mismatch: ${JSON.stringify(data.members)}`);
      }
      if (data.members[0].name !== '佐藤' || data.members[0].station !== '桂') {
        throw new Error(`member mismatch: ${JSON.stringify(data.members[0])}`);
      }
    },
  },
  {
    name: '京都河原町補正',
    input: '河原町でいい？\n佐藤: からすまおいけです',
    validate: (data) => {
      if (data.venue !== '京都河原町') throw new Error(`venue mismatch: ${data.venue}`);
      if (data.meetAt !== null) throw new Error(`meetAt should be null: ${data.meetAt}`);
      if (!Array.isArray(data.members) || data.members.length !== 1) {
        throw new Error(`members length mismatch: ${JSON.stringify(data.members)}`);
      }
      if (data.members[0].name !== '佐藤' || data.members[0].station !== '烏丸御池') {
        throw new Error(`member mismatch: ${JSON.stringify(data.members[0])}`);
      }
    },
  },
  {
    name: '行けない人は除外',
    input: '今日19時に三条集合ー\n田中: 行きます！鞍馬から向かいます\n佐藤: ごめん今日いけない\n鈴木: 私も行く 烏丸御池です',
    validate: (data) => {
      if (data.venue !== '三条') throw new Error(`venue mismatch: ${data.venue}`);
      if (data.meetAt !== '19:00') throw new Error(`meetAt mismatch: ${data.meetAt}`);
      if (!Array.isArray(data.members) || data.members.length !== 2) {
        throw new Error(`members length mismatch: ${JSON.stringify(data.members)}`);
      }
      if (data.members.some((member) => member.name === '佐藤')) {
        throw new Error(`declining member should be excluded: ${JSON.stringify(data.members)}`);
      }
    },
  },
  {
    name: '駅名の揺れ',
    input: '20時に京都駅\n田中: 河原町から行く\n佐藤: 四条烏丸から行く',
    validate: (data) => {
      if (data.venue !== '京都') throw new Error(`venue mismatch: ${data.venue}`);
      if (data.meetAt !== '20:00') throw new Error(`meetAt mismatch: ${data.meetAt}`);
      if (!Array.isArray(data.members) || data.members.length !== 2) {
        throw new Error(`members length mismatch: ${JSON.stringify(data.members)}`);
      }
      if (data.members[0].station === '河原町' || data.members[1].station === '四条烏丸') {
        throw new Error(`station should be normalized: ${JSON.stringify(data.members)}`);
      }
    },
  },
  {
    name: '超長入力',
    input: 'a'.repeat(10001),
    expectedStatus: 400,
    validate: (data) => {
      if (data.error !== '文字数が多すぎます。1万文字以内にしてください') {
        throw new Error(`overlong input: ${JSON.stringify(data)}`);
      }
    },
  },
];

async function callParse(text) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON response: ${raw}`);
  }

  return { status: response.status, data };
}

async function run() {
  console.log(`Testing API at ${API_URL}`);

  for (const testCase of cases) {
    try {
      const result = await callParse(testCase.input);
      const { status, data } = result;
      const expectedStatus = testCase.expectedStatus ?? 200;

      console.log(`\n[${testCase.name}] status=${status}`);
      console.log(JSON.stringify(data));

      if (status !== expectedStatus) {
        throw new Error(`Expected status ${expectedStatus} but got ${status}: ${JSON.stringify(data)}`);
      }

      testCase.validate(data);
      console.log(`✅ ${testCase.name}: passed`);
    } catch (error) {
      console.error(`❌ ${testCase.name}: failed`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }

  if (process.exitCode === 1) {
    console.log('\nOne or more parser tests failed.');
    process.exit(1);
  }

  console.log('\nAll parser tests passed.');
}

run().catch((error) => {
  console.error('Unexpected test runner error:', error);
  process.exit(1);
});
