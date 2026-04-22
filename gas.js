// ════════════════════════════════════════════════════════
// 計算力育成アプリ - GAS バックエンド
// Google Apps Script にそのままペーストして使用
// ════════════════════════════════════════════════════════

const SHEET_USERS   = 'users';
const SHEET_LOGS    = 'logs';
const ADMIN_PW_KEY  = 'ADMIN_PASSWORD'; // スクリプトプロパティに設定

// ── シート取得ヘルパー ─────────────────────────────────
function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

// ── CORS ヘッダー付きレスポンス ────────────────────────
function jsonRes(data, code) {
  const output = ContentService
    .createTextOutput(JSON.stringify({code: code || 200, ...data}))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ── エントリーポイント ─────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'login')       return handleLogin(body);
    if (action === 'setNickname') return handleSetNickname(body);
    if (action === 'savelog')     return handleSaveLog(body);
    if (action === 'ranking')     return handleRanking(body);
    if (action === 'addUser')     return handleAddUser(body);
    if (action === 'getUsers')    return handleGetUsers(body);
    if (action === 'getLogs')     return handleGetLogs(body);
    if (action === 'deleteUser')  return handleDeleteUser(body);
    if (action === 'updateUser')  return handleUpdateUser(body);
    if (action === 'myLogs')      return handleMyLogs(body);

    return jsonRes({error: 'unknown action'}, 400);
  } catch(err) {
    return jsonRes({error: err.message}, 500);
  }
}

function doGet(e) {
  // ランキング取得（GETでも可）
  try {
    const level = e.parameter.level;
    if (!level) return jsonRes({error: 'level required'}, 400);
    return getRankingData(level);
  } catch(err) {
    return jsonRes({error: err.message}, 500);
  }
}

// ════════════════════════════════════════════════════════
// ログイン
// ════════════════════════════════════════════════════════
function handleLogin(body) {
  const {code, password} = body;
  if (!code || !password) return jsonRes({error: 'code/password required'}, 400);

  const sheet = getSheet(SHEET_USERS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const [uCode, uPw, uNick, regDate] = data[i];
    if (String(uCode) === String(code) && String(uPw) === String(password)) {
      // 最終ログイン更新
      sheet.getRange(i + 1, 5).setValue(new Date());
      return jsonRes({
        ok: true,
        nickname: uNick || '',
        needNickname: !uNick,
        code: uCode
      });
    }
  }
  return jsonRes({ok: false, error: 'コードまたはパスワードが違います'});
}

// ════════════════════════════════════════════════════════
// ニックネーム設定（初回）
// ════════════════════════════════════════════════════════
function handleSetNickname(body) {
  const {code, nickname} = body;
  if (!code || !nickname) return jsonRes({error: 'required'}, 400);
  if (nickname.length > 10) return jsonRes({error: 'ニックネームは10文字以内'}, 400);

  const sheet = getSheet(SHEET_USERS);
  const data = sheet.getDataRange().getValues();

  // 重複チェック
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(code) && data[i][2] === nickname) {
      return jsonRes({ok: false, error: 'そのニックネームは使われています'});
    }
  }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(code)) {
      sheet.getRange(i + 1, 3).setValue(nickname);
      return jsonRes({ok: true, nickname});
    }
  }
  return jsonRes({ok: false, error: 'ユーザーが見つかりません'});
}

// ════════════════════════════════════════════════════════
// ログ保存
// ════════════════════════════════════════════════════════
function handleSaveLog(body) {
  const {code, nickname, level, levelTitle, nQ, correct, timeSec, mode} = body;
  if (!code || !level) return jsonRes({error: 'required'}, 400);

  const sheet = getSheet(SHEET_LOGS);
  const rate = Math.round(correct / nQ * 100);
  const passed = (correct === nQ);

  sheet.appendRow([
    new Date(),    // A: 日時
    code,          // B: 生徒コード
    nickname,      // C: ニックネーム
    level,         // D: 級key
    levelTitle,    // E: 級タイトル
    nQ,            // F: 問題数
    correct,       // G: 正答数
    rate,          // H: 正答率(%)
    timeSec,       // I: タイム(秒)
    mode,          // J: practice/test
    passed ? '合格' : '-'  // K: 合否
  ]);

  return jsonRes({ok: true, rate, passed});
}

// ════════════════════════════════════════════════════════
// ランキング取得（検定・満点のみ）
// ════════════════════════════════════════════════════════
function handleRanking(body) {
  const {level} = body;
  if (!level) return jsonRes({error: 'level required'}, 400);
  return getRankingData(level);
}

function getRankingData(level) {
  const sheet = getSheet(SHEET_LOGS);
  const data = sheet.getDataRange().getValues();

  // 検定・満点のみ・指定レベルのデータ抽出
  const map = {}; // code → {nickname, bestTime, count}
  for (let i = 1; i < data.length; i++) {
    const [date, code, nick, lv, lvTitle, nQ, correct, rate, timeSec, mode] = data[i];
    if (lv !== level) continue;
    if (mode !== 'test') continue;
    if (correct !== nQ) continue; // 満点のみ

    if (!map[code] || timeSec < map[code].best) {
      map[code] = {
        nickname: nick,
        best: timeSec,
        count: (map[code] ? map[code].count : 0) + 1
      };
    } else {
      map[code].count++;
    }
  }

  // ソート（タイム昇順）
  const ranking = Object.entries(map)
    .map(([code, d]) => ({nickname: d.nickname, best: d.best, count: d.count}))
    .sort((a, b) => a.best - b.best)
    .slice(0, 20); // 上位20件

  return jsonRes({ok: true, level, ranking});
}

// ════════════════════════════════════════════════════════
// 自分のログ取得
// ════════════════════════════════════════════════════════
function handleMyLogs(body) {
  const {code, password} = body;

  // 認証
  const sheet = getSheet(SHEET_USERS);
  const users = sheet.getDataRange().getValues();
  let auth = false;
  for (let i = 1; i < users.length; i++) {
    if (String(users[i][0]) === String(code) &&
        String(users[i][1]) === String(password)) { auth = true; break; }
  }
  if (!auth) return jsonRes({ok: false, error: '認証失敗'});

  const logSheet = getSheet(SHEET_LOGS);
  const data = logSheet.getDataRange().getValues();
  const headers = data[0];
  const myLogs = [];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === String(code)) {
      myLogs.push({
        date:      data[i][0],
        level:     data[i][3],
        title:     data[i][4],
        nQ:        data[i][5],
        correct:   data[i][6],
        rate:      data[i][7],
        time:      data[i][8],
        mode:      data[i][9],
        passed:    data[i][10]
      });
    }
  }
  // 新しい順
  myLogs.reverse();
  return jsonRes({ok: true, logs: myLogs.slice(0, 50)});
}

// ════════════════════════════════════════════════════════
// 管理者機能（全てadminPW認証が必要）
// ════════════════════════════════════════════════════════
function checkAdmin(pw) {
  const saved = PropertiesService.getScriptProperties().getProperty(ADMIN_PW_KEY);
  return saved && pw === saved;
}

// 生徒追加
function handleAddUser(body) {
  if (!checkAdmin(body.adminPw)) return jsonRes({error: '管理者認証失敗'}, 401);
  const {code, password, nickname} = body;
  if (!code || !password) return jsonRes({error: 'code/password required'}, 400);

  const sheet = getSheet(SHEET_USERS);
  const data = sheet.getDataRange().getValues();

  // 重複チェック
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(code)) {
      return jsonRes({ok: false, error: 'そのコードは既に存在します'});
    }
  }

  sheet.appendRow([code, password, nickname || '', new Date(), '']);
  return jsonRes({ok: true});
}

// 生徒一覧取得
function handleGetUsers(body) {
  if (!checkAdmin(body.adminPw)) return jsonRes({error: '管理者認証失敗'}, 401);

  const sheet = getSheet(SHEET_USERS);
  const data = sheet.getDataRange().getValues();
  const users = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    users.push({
      code:       data[i][0],
      nickname:   data[i][2] || '（未設定）',
      regDate:    data[i][3],
      lastLogin:  data[i][4]
    });
  }
  return jsonRes({ok: true, users});
}

// ログ一覧取得（管理者）
function handleGetLogs(body) {
  if (!checkAdmin(body.adminPw)) return jsonRes({error: '管理者認証失敗'}, 401);
  const {targetCode, limit} = body;

  const sheet = getSheet(SHEET_LOGS);
  const data = sheet.getDataRange().getValues();
  const logs = [];

  for (let i = 1; i < data.length; i++) {
    if (targetCode && String(data[i][1]) !== String(targetCode)) continue;
    logs.push({
      date:    data[i][0],
      code:    data[i][1],
      nick:    data[i][2],
      level:   data[i][3],
      title:   data[i][4],
      nQ:      data[i][5],
      correct: data[i][6],
      rate:    data[i][7],
      time:    data[i][8],
      mode:    data[i][9],
      passed:  data[i][10]
    });
  }
  logs.reverse();
  return jsonRes({ok: true, logs: logs.slice(0, limit || 200)});
}

// 生徒更新（パスワード変更など）
function handleUpdateUser(body) {
  if (!checkAdmin(body.adminPw)) return jsonRes({error: '管理者認証失敗'}, 401);
  const {code, newPassword, newNickname} = body;

  const sheet = getSheet(SHEET_USERS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(code)) {
      if (newPassword) sheet.getRange(i + 1, 2).setValue(newPassword);
      if (newNickname !== undefined) sheet.getRange(i + 1, 3).setValue(newNickname);
      return jsonRes({ok: true});
    }
  }
  return jsonRes({ok: false, error: 'ユーザーが見つかりません'});
}

// 生徒削除
function handleDeleteUser(body) {
  if (!checkAdmin(body.adminPw)) return jsonRes({error: '管理者認証失敗'}, 401);
  const {code} = body;

  const sheet = getSheet(SHEET_USERS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(code)) {
      sheet.deleteRow(i + 1);
      return jsonRes({ok: true});
    }
  }
  return jsonRes({ok: false, error: 'ユーザーが見つかりません'});
}

// ════════════════════════════════════════════════════════
// 初期セットアップ（初回1回だけ実行）
// ════════════════════════════════════════════════════════
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // usersシート
  let us = ss.getSheetByName(SHEET_USERS);
  if (!us) us = ss.insertSheet(SHEET_USERS);
  if (us.getLastRow() === 0) {
    us.appendRow(['コード','パスワード','ニックネーム','登録日','最終ログイン']);
    us.getRange(1,1,1,5).setFontWeight('bold').setBackground('#1A3A5C').setFontColor('white');
  }

  // logsシート
  let ls = ss.getSheetByName(SHEET_LOGS);
  if (!ls) ls = ss.insertSheet(SHEET_LOGS);
  if (ls.getLastRow() === 0) {
    ls.appendRow(['日時','コード','ニックネーム','級key','級タイトル','問題数','正答数','正答率(%)','タイム(秒)','モード','合否']);
    ls.getRange(1,1,1,11).setFontWeight('bold').setBackground('#1A3A5C').setFontColor('white');
  }

  Browser.msgBox('セットアップ完了！次にスクリプトプロパティに ADMIN_PASSWORD を設定してください。');
}
