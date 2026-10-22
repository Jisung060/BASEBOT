"""
BASEBOT 커뮤니티 발표용 테스트 데이터 입력 / 삭제

파일 위치: back/scripts/seed_community_demo.py
실행 위치: back/

사용법
    python scripts/seed_community_demo.py --me 내아이디            # 입력 (내 계정에도 활동 기록 연결)
    python scripts/seed_community_demo.py                          # 입력 (내 계정 연결 없이)
    python scripts/seed_community_demo.py --reset --me 내아이디    # 지우고 다시 입력
    python scripts/seed_community_demo.py --remove                 # 테스트 데이터만 삭제

안전장치
- 테스트 회원은 username이 demo_ 로 시작하고, 로그인할 수 없는 비밀번호로 저장됩니다.
- 내 계정이 쓴 테스트 글에는 본문 끝에 <!--BASEBOT_DEMO--> 표시가 붙어서 삭제 때 구분됩니다.
- 삭제는 테스트 글(과 그 댓글/좋아요/스크랩/신고)과 demo_ 회원만 지웁니다. 기존 실제 데이터는 건드리지 않습니다.
"""
import argparse
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

BACK_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACK_DIR))

from sqlalchemy import text
from database.db_connection import engine

engine.echo = False   # 터미널에 SQL이 쏟아지지 않도록 이 스크립트에서만 끈다

MARK = "<!--BASEBOT_DEMO-->"
DEMO_PW = "!DEMO_NO_LOGIN"     # 이 값으로는 로그인할 수 없다 (해시 형식이 아님)
rnd = random.Random(2026)
NOW = datetime.now().replace(microsecond=0)

# ------------------------------------------------------------------ 테스트 회원
DEMO_USERS = [
    ("demo_01", "다저스덕후", "LAD"), ("demo_02", "양키스팬", "NYY"),
    ("demo_03", "분석왕김", None),    ("demo_04", "야구뉴비", None),
    ("demo_05", "컵스사랑", "CHC"),   ("demo_06", "직관러버", "SF"),
    ("demo_07", "세이버러", None),    ("demo_08", "레드삭스팬", "BOS"),
    ("demo_09", "불펜분석가", "HOU"), ("demo_10", "주말야구", None),
    ("demo_11", "매리너스팬", "SEA"), ("demo_12", "야알못탈출", None),
]

# ------------------------------------------------------------------ 게시글 30개
# (카테고리, 팀코드, 제목, 본문, 작성자번호(0~11 또는 'ME'), 조회수, 목표 좋아요 수, 상태)
P = []
def add(cat, team, title, body, author, views, likes, status="ACTIVE"):
    P.append(dict(cat=cat, team=team, title=title, body=body, author=author, views=views, likes=likes, status=status))

add("ANALYSIS","NYY","양키스 타선, wRC+로 보면 어떤 흐름일까요?",
    "단순 타율보다 wRC+를 같이 보면 팀 타선의 생산성이 더 잘 보입니다. 구장 효과와 리그 평균을 보정한 지표라서 팀 간 비교가 편합니다. 여러분은 어떤 지표를 가장 신뢰하시나요?",1,612,11)
add("GENERAL","LAD","다저스 불펜 운영, 어떻게 보시나요?",
    "요즘 경기를 보면 불펜 교체 타이밍이 꽤 빠르다는 느낌입니다. 선발이 6이닝을 채우지 못하는 날이 늘었는데, 이게 의도된 운영인지 궁금해요.",0,540,10)
add("ANALYSIS","LAD","xwOBA와 실제 wOBA 차이가 큰 타자들 정리",
    "기대 지표(xwOBA)가 실제 성적보다 높으면 운이 따르지 않았을 가능성이 있고, 반대면 운이 좋았을 수 있습니다. 시즌 중반에 이 차이를 보는 방법을 공유합니다.",2,498,9)
add("GENERAL",None,"야구 처음 보는데 입문용 용어 추천해 주세요",
    "친구 따라 MLB를 보기 시작했는데 WAR, OPS, 세이브 같은 말이 잘 안 들어옵니다. 처음 알아두면 좋은 용어를 알려 주세요.","ME",233,7)
add("GAME_THREAD","BOS","[경기 스레드] 레드삭스 vs 양키스 오늘 경기 같이 봐요",
    "오늘 선발 매치업이 기대됩니다. 경기 보면서 편하게 이야기 나눠요. 스포일러는 자제 부탁드립니다.",7,310,6)
add("NEWS",None,"이번 주 MLB 주요 소식 정리",
    "이번 주 주요 경기 결과와 부상자 명단 변동을 간단히 정리했습니다. 빠진 소식이 있으면 댓글로 보태 주세요.",3,287,5)
add("GENERAL","SF","자이언츠 홈구장 직관 후기",
    "해 질 무렵에 가면 구장 분위기가 정말 좋습니다. 먹거리 줄이 길어서 일찍 가는 걸 추천해요. 사진도 많이 찍었습니다.",5,342,8)
add("GAME_THREAD","CHC","[경기 스레드] 컵스 vs 카디널스 라이브",
    "오늘 라이벌전입니다. 1회부터 분위기가 뜨겁네요. 같이 보실 분 계시면 댓글 남겨 주세요.",4,190,4)
add("ANALYSIS","HOU","애스트로스 선발진 구속 변화 정리",
    "시즌 초와 최근 평균 구속을 비교해 보니 변화가 눈에 띄는 투수가 있습니다. 구속이 떨어지면 삼진율도 같이 떨어지는지 확인해 봤어요.",8,265,5)
add("NEWS","SEA","매리너스 트레이드 소식, 어떻게 생각하세요?",
    "이번 트레이드로 선발진 뎁스가 좋아질지 의견이 갈리는 것 같습니다. 팬분들 생각이 궁금합니다.",10,221,3)
add("GENERAL",None,"응원팀 정하는 방법, 저는 이렇게 정했어요",
    "연고지, 좋아하는 선수, 유니폼 디자인 등 기준이 다양합니다. 저는 한 시즌 동안 여러 팀 경기를 보고 정했어요. 여러분은 어떻게 정하셨나요?",11,174,4)
add("ANALYSIS",None,"FIP와 ERA 차이, 언제 믿어야 할까요",
    "수비와 운의 영향을 뺀 FIP가 ERA와 크게 다르면 다음 시즌 성적을 예측하는 데 도움이 되는 편입니다. 다만 표본이 작으면 주의가 필요합니다.",6,305,6)
add("GENERAL","ATL","브레이브스 팬분들 계신가요?",
    "국내 팬 모임이 있는지 궁금합니다. 같이 경기 보면서 이야기하면 좋을 것 같아요.",9,98,2)
add("GAME_THREAD","TOR","[경기 스레드] 블루제이스 홈경기",
    "지붕이 열린 구장에서 하는 경기라 분위기가 좋습니다. 타선이 오늘 터지길 기대해 봅니다.",1,121,2)
add("GENERAL","TEX","레인저스 응원가 추천 부탁드려요",
    "경기 영상을 보다가 응원가가 마음에 들었습니다. 유명한 응원가나 구호가 있으면 알려 주세요.",3,87,1)
add("ANALYSIS","SD","파드리스 수비 지표(OAA) 분석",
    "Outs Above Average로 포지션별 수비 기여도를 비교해 봤습니다. 외야 수비 차이가 생각보다 크게 나옵니다.",6,248,5)
add("NEWS","NYM","메츠 부상자 명단 업데이트",
    "주전 몇 명이 부상자 명단에 올랐습니다. 복귀 예정 시기를 정리해 두었으니 참고하세요.",4,133,3)
add("GENERAL",None,"BASEBOT 챗봇 써 본 후기",
    "선수 성적을 물어보면 바로 정리해 줘서 편했습니다. 경기 예측 기능도 재미있었어요. 어떤 질문을 해 보셨나요?","ME",205,6)
add("ANALYSIS","BAL","오리올스 젊은 선수들 성장 지표",
    "젊은 타자들의 삼진율과 볼넷율이 시즌 동안 어떻게 변했는지 살펴봤습니다. 선구안이 좋아지는 흐름이 보입니다.",8,179,4)
add("GENERAL","MIL","브루어스는 왜 저평가될까요?",
    "성적에 비해 이야기가 적은 팀 같습니다. 규모가 작은 시장이라 그런지, 스타 선수가 적어서 그런지 궁금합니다.",9,102,2)
add("GAME_THREAD","PHI","[경기 스레드] 필리스 홈 응원 열기",
    "홈 팬들의 응원이 정말 대단합니다. 오늘도 만원 관중일 것 같아요. 같이 보면서 이야기해요.",0,144,3)
add("GENERAL","MIN","트윈스 유니폼 디자인 어떤가요?",
    "올해 유니폼이 깔끔하다는 의견이 많던데 여러분은 어떻게 보시나요?",10,66,1)
add("ANALYSIS","TB","레이스의 저비용 고효율 전략",
    "예산이 적어도 꾸준히 성적을 내는 비결을 선수 육성과 포지션 유연성 중심으로 정리해 봤습니다.",2,253,6)
add("NEWS",None,"신인 드래프트 관련 이슈 모음",
    "드래프트 순위와 주목받는 유망주 이야기를 모았습니다. 관심 있는 선수가 있으면 댓글로 알려 주세요.",7,118,2)
add("GENERAL","CLE","가디언스 팬분들 이야기 나눠요",
    "팀 이름이 바뀐 뒤 분위기가 어떤지 궁금합니다. 응원 문화도 알고 싶어요.",5,75,1)
add("GENERAL","DET","디트로이트 직관 계획 세우는 중입니다",
    "다음 달에 직관을 가려고 하는데 좌석은 어디가 좋을까요? 가 보신 분들 조언 부탁드립니다.","ME",151,3)
add("ANALYSIS",None,"배트 스피드와 스쿼어드업 비율의 관계",
    "배트 스피드가 빠르면 스쿼어드업 비율도 높을까요? 선수별 수치를 놓고 간단히 비교해 봤습니다.",6,289,7)
add("GENERAL",None,"(광고) 중고 유니폼 싸게 팝니다 문의 주세요",
    "정품 유니폼 저렴하게 판매합니다. 자세한 내용은 아래 링크로 문의 주세요. 많은 관심 부탁드립니다.",11,41,0,"HIDDEN")
add("GENERAL",None,"상대 팀 팬들은 다 이상하다는 글",
    "상대 팀 팬들은 전부 말이 안 통한다는 식의 비하 글입니다. 신고 처리 시연을 위한 예시 게시글입니다.",3,57,0,"HIDDEN")
add("GENERAL","BOS","같은 내용 도배 글입니다 (신고 시연용)",
    "같은 문장을 반복해서 올리는 도배성 게시글 예시입니다. 신고가 여러 건 접수된 상태를 보여 주기 위한 데이터입니다.",1,29,1)

# ------------------------------------------------------------------ 댓글 / 대댓글 문구
COMMENTS = ["좋은 글 잘 읽었습니다.","저도 같은 생각이에요.","이 부분은 조금 다르게 볼 수도 있을 것 같아요.","정리해 주셔서 감사합니다.",
 "지표로 보니까 이해가 잘 되네요.","다음 경기도 기대됩니다.","오늘 경기 정말 재밌었어요.","초보라 공부가 많이 됩니다.",
 "출처가 있으면 더 좋겠어요.","공감합니다. 저도 비슷하게 느꼈어요.","다른 의견도 궁금하네요.","사진 더 올려 주세요!",
 "저는 반대로 생각했는데 이유를 들어 보니 납득이 됩니다.","시즌 끝나고 다시 비교해 보면 재밌겠네요.","추천 누르고 갑니다.",
 "이런 글 자주 올려 주세요.","표본이 아직 작아서 더 지켜봐야 할 것 같아요.","댓글로 의견 남겨요, 좋은 토론 되길 바랍니다."]
REPLIES = ["맞아요, 저도 그 부분이 궁금했어요.","의견 감사합니다. 참고할게요.","그렇게 볼 수도 있겠네요.","ㅎㅎ 저도요!",
 "자세히 설명해 주셔서 고맙습니다.","다음에 더 정리해서 올릴게요.","좋은 지적이세요.","확인해 보고 다시 말씀드릴게요."]
REPORT_TEXT = {"ABUSE":"특정 팬층을 비하하는 표현이 있습니다.","AD":"판매 목적의 광고성 글입니다.","SPAM":"같은 내용이 반복되는 도배 글입니다.",
               "INAPPROPRIATE":"게시판 성격과 맞지 않는 내용입니다.","ETC":"기타 사유로 신고합니다."}

# ------------------------------------------------------------------ 삭제
def remove(conn):
    ids = [r[0] for r in conn.execute(text(
        "SELECT post_id FROM community_posts WHERE content LIKE :m OR user_id IN "
        "(SELECT user_id FROM users WHERE SUBSTR(username,1,5)='demo_')"), {"m": f"%{MARK}%"}).all()]
    if ids:
        from sqlalchemy import bindparam
        cids = "SELECT comment_id FROM comments WHERE post_id IN :ids"
        for sql in [
            f"DELETE FROM comment_likes WHERE comment_id IN ({cids})",
            "DELETE FROM comments WHERE post_id IN :ids AND parent_comment_id IS NOT NULL",
            "DELETE FROM comments WHERE post_id IN :ids",
            "DELETE FROM post_likes WHERE post_id IN :ids",
            "DELETE FROM post_scraps WHERE post_id IN :ids",
            "DELETE FROM post_reports WHERE post_id IN :ids",
            "DELETE FROM community_images WHERE post_id IN :ids",
            "DELETE FROM community_posts WHERE post_id IN :ids",
        ]:
            conn.execute(text(sql).bindparams(bindparam("ids", expanding=True)), {"ids": ids})
    n = conn.execute(text("DELETE FROM users WHERE SUBSTR(username,1,5)='demo_'")).rowcount
    print(f"삭제: 테스트 게시글 {len(ids)}개와 그에 딸린 데이터, 테스트 회원 {n}명")

# ------------------------------------------------------------------ 입력
def seed(conn, me_username):
    teams = {r[1]: r[0] for r in conn.execute(text("SELECT team_id, team_code FROM teams")).all()}
    alias = {"AZ": ["ARI"], "OAK": ["ATH"]}
    def tid(code):
        if not code: return None
        if code in teams: return teams[code]
        print(f"  (경고) teams에 {code} 가 없어 관련 구단을 비워 둡니다")
        return None

    me_id = None
    if me_username:
        row = conn.execute(text("SELECT user_id FROM users WHERE username=:u"), {"u": me_username}).first()
        if not row:
            sys.exit(f"'{me_username}' 계정을 users 에서 찾을 수 없습니다. 아이디를 확인해 주세요.")
        me_id = row[0]

    if conn.execute(text("SELECT COUNT(*) FROM users WHERE SUBSTR(username,1,5)='demo_'")).scalar():
        sys.exit("테스트 데이터가 이미 있습니다. 다시 만들려면 --reset 을 붙여 실행하세요.")

    # 회원
    uids = []
    for i, (un, nick, team) in enumerate(DEMO_USERS, 1):
        r = conn.execute(text("""INSERT INTO users (username,password,nickname,email,favorite_team_id)
            VALUES (:u,:p,:n,:e,:t)"""), {"u": un, "p": DEMO_PW, "n": nick, "e": f"{un}@basebot.test", "t": tid(team)})
        uids.append(r.lastrowid)

    author_id = lambda a: me_id if (a == "ME" and me_id) else uids[(a if a != "ME" else 3)]
    n = len(P)
    # 작성 시각: 14일 전부터 현재까지 순서대로 (아래쪽 번호일수록 오래된 글이 되지 않도록 섞음)
    offsets = sorted(rnd.sample(range(2, 14 * 24 * 60, 7), n), reverse=True)
    created = [NOW - timedelta(minutes=m) for m in offsets]
    rnd.shuffle(created)

    posts = []
    for i, p in enumerate(P):
        aid = author_id(p["author"])
        body = f"<p>{p['body']}</p>"
        if p["author"] == "ME" and me_id: body += MARK
        p["aid"], p["html"], p["created"] = aid, body, created[i]
        p["likers"] = []

    # 좋아요 대상 선정
    others = lambda aid: [u for u in uids if u != aid]
    for p in P:
        k = min(p["likes"], len(others(p["aid"])))
        p["likers"] = rnd.sample(others(p["aid"]), k)
    me_like = set()
    if me_id:
        me_like = {0, 1, 2, 5, 6, 11, 14, 24}
        for i in me_like:
            if P[i]["aid"] != me_id and me_id not in P[i]["likers"]:
                P[i]["likers"].append(me_id)

    # 댓글 계획 (게시글 번호 -> 최상위 댓글 수), 대댓글
    plan = {0:6,1:7,2:5,3:5,4:4,5:3,6:5,7:3,8:3,9:2,10:3,11:4,12:1,13:2,14:0,15:2,16:4,17:2,18:1,19:2,20:0,21:3,22:1,23:2,24:1,25:4,26:0,27:0,28:2}
    cinfo = {}   # post idx -> list of dict(top, replies[])
    for i, k in plan.items():
        if i >= n: continue
        lst = []
        for _ in range(k):
            lst.append({"user": rnd.choice(uids), "text": rnd.choice(COMMENTS), "replies": []})
        for c in lst:
            for _ in range(rnd.choice([0, 0, 1, 1, 2])):
                c["replies"].append({"user": rnd.choice(uids), "text": rnd.choice(REPLIES)})
        cinfo[i] = lst
    # 내 계정 댓글/대댓글 (내가 쓴 글이 아닌 글에)
    if me_id:
        for i in (0, 1, 4, 6, 11):
            lst = cinfo.setdefault(i, [])
            c = {"user": me_id, "text": "저도 흥미롭게 읽었습니다. 좋은 정보 감사합니다.", "replies": []}
            lst.append(c)
            if lst[0]["user"] != me_id:
                lst[0]["replies"].append({"user": me_id, "text": "의견 감사합니다. 저도 비슷하게 생각했어요."})
        cinfo.setdefault(3, []).append({"user": rnd.choice(uids), "text": "용어는 WAR, OPS부터 보면 좋아요.", "replies": [{"user": me_id, "text": "알려 주셔서 감사합니다!"}]})

    # 게시글 입력
    pids = []
    for i, p in enumerate(P):
        ccount = sum(1 + len(c["replies"]) for c in cinfo.get(i, []))
        r = conn.execute(text("""INSERT INTO community_posts
            (user_id,category,related_team_id,title,content,view_count,like_count,comment_count,created_at,updated_at,status)
            VALUES (:u,:c,:t,:ti,:co,:v,:l,:cc,:ca,:ca,:s)"""),
            {"u": p["aid"], "c": p["cat"], "t": tid(p["team"]), "ti": p["title"], "co": p["html"],
             "v": p["views"], "l": len(p["likers"]), "cc": ccount, "ca": p["created"], "s": p["status"]})
        pids.append(r.lastrowid)

    # 댓글 입력 (+ 댓글 좋아요)
    total_c = total_cl = 0
    for i, lst in cinfo.items():
        base = P[i]["created"]
        for c in lst:
            t0 = min(NOW, base + timedelta(minutes=rnd.randint(5, 1500)))
            cl = rnd.sample([u for u in uids if u != c["user"]], rnd.choice([0, 0, 1, 2, 3, 4]))
            r = conn.execute(text("""INSERT INTO comments (post_id,user_id,parent_comment_id,content,like_count,created_at,updated_at)
                VALUES (:p,:u,NULL,:c,:l,:t,:t)"""), {"p": pids[i], "u": c["user"], "c": c["text"], "l": len(cl), "t": t0})
            cid = r.lastrowid; total_c += 1
            for u in cl:
                conn.execute(text("INSERT INTO comment_likes (comment_id,user_id,created_at) VALUES (:c,:u,:t)"), {"c": cid, "u": u, "t": t0}); total_cl += 1
            for rp in c["replies"]:
                t1 = min(NOW, t0 + timedelta(minutes=rnd.randint(3, 600)))
                rl = rnd.sample([u for u in uids if u != rp["user"]], rnd.choice([0, 0, 1, 2]))
                r2 = conn.execute(text("""INSERT INTO comments (post_id,user_id,parent_comment_id,content,like_count,created_at,updated_at)
                    VALUES (:p,:u,:pc,:c,:l,:t,:t)"""), {"p": pids[i], "u": rp["user"], "pc": cid, "c": rp["text"], "l": len(rl), "t": t1})
                total_c += 1
                for u in rl:
                    conn.execute(text("INSERT INTO comment_likes (comment_id,user_id,created_at) VALUES (:c,:u,:t)"), {"c": r2.lastrowid, "u": u, "t": t1}); total_cl += 1

    # 게시글 좋아요
    total_l = 0
    for i, p in enumerate(P):
        for u in p["likers"]:
            conn.execute(text("INSERT INTO post_likes (post_id,user_id,created_at) VALUES (:p,:u,:t)"),
                         {"p": pids[i], "u": u, "t": min(NOW, p["created"] + timedelta(minutes=rnd.randint(2, 3000)))}); total_l += 1

    # 스크랩 (내 계정 6개 + 테스트 회원 약 24개)
    pairs = set()
    if me_id:
        for i in (0, 1, 2, 6, 11, 24): pairs.add((i, me_id))
    active = [i for i, p in enumerate(P) if p["status"] == "ACTIVE"]
    while len(pairs) < (30 if me_id else 24):
        i = rnd.choice(active[:20]); u = rnd.choice(uids)
        if P[i]["aid"] != u: pairs.add((i, u))
    for i, u in sorted(pairs):
        conn.execute(text("INSERT INTO post_scraps (post_id,user_id,created_at) VALUES (:p,:u,:t)"),
                     {"p": pids[i], "u": u, "t": min(NOW, P[i]["created"] + timedelta(minutes=rnd.randint(10, 4000)))})

    # 신고 (글 번호, 사유, 처리 상태, 신고자 목록)
    REP = [
        (27, "AD", "ACCEPTED", [uids[0], uids[2]]),
        (28, "ABUSE", "ACCEPTED", [uids[4], uids[6]]),
        (29, "SPAM", "PENDING", [uids[5], uids[7], uids[8]] + ([me_id] if me_id else [])),
        (4, "INAPPROPRIATE", "PENDING", [uids[9]]),
        (12, "ETC", "REJECTED", [uids[10]]),
        (19, "ETC", "REVIEWED", [uids[11]]),
        (13, "AD", "PENDING", [uids[1]] + ([me_id] if me_id else [])),
    ]
    total_r = 0
    for i, reason, status, reporters in REP:
        for u in reporters:
            t0 = min(NOW, P[i]["created"] + timedelta(hours=rnd.randint(1, 30)))
            rv = None if status == "PENDING" else min(NOW, t0 + timedelta(hours=rnd.randint(2, 20)))
            conn.execute(text("""INSERT INTO post_reports (post_id,user_id,reason,content,status,created_at,reviewed_at)
                VALUES (:p,:u,:r,:c,:s,:t,:rv)"""), {"p": pids[i], "u": u, "r": reason, "c": REPORT_TEXT[reason], "s": status, "t": t0, "rv": rv}); total_r += 1

    act = sum(1 for p in P if p["status"] == "ACTIVE")
    top = sorted(((len(p["likers"]), p["title"]) for p in P if p["status"] == "ACTIVE"), reverse=True)[:3]
    print(f"입력 완료: 회원 {len(uids)}명, 게시글 {n}개(공개 {act}, 숨김 {n-act}), 댓글·대댓글 {total_c}개, 댓글 좋아요 {total_cl}개,")
    print(f"           게시글 좋아요 {total_l}개, 스크랩 {len(pairs)}개, 신고 {total_r}건")
    print("인기 게시글 상위 3:"); [print(f"  - 좋아요 {c}: {t}") for c, t in top]
    if me_id: print(f"내 계정({me_username})에 글 3개, 댓글, 좋아요, 스크랩, 신고 기록을 연결했습니다.")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--me", help="내 로그인 아이디(username). 지정하면 내 계정에도 활동 기록을 연결")
    ap.add_argument("--reset", action="store_true", help="테스트 데이터를 지우고 다시 입력")
    ap.add_argument("--remove", action="store_true", help="테스트 데이터만 삭제")
    a = ap.parse_args()
    with engine.begin() as conn:
        if a.remove or a.reset: remove(conn)
        if not a.remove: seed(conn, a.me)

if __name__ == "__main__":
    main()
