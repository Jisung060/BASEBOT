-- BASEBOT Community 추가 테이블
-- 기존 community_posts / comments / post_likes / comment_likes / community_images는 유지합니다.
-- 아래 테이블은 스크랩 / 신고 / 대댓글 기능을 DB에서 실제 저장하기 위해 추가합니다.

USE basebot;

-- 1. 게시글 스크랩
CREATE TABLE IF NOT EXISTS post_scraps (
    scrap_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    post_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_post_scraps_post
        FOREIGN KEY (post_id)
        REFERENCES community_posts(post_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_post_scraps_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,

    CONSTRAINT uk_post_scraps_post_user
        UNIQUE (post_id, user_id),

    INDEX idx_post_scraps_user (user_id),
    INDEX idx_post_scraps_post (post_id)
);

-- 2. 게시글 신고
CREATE TABLE IF NOT EXISTS post_reports (
    report_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    post_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,

    reason ENUM(
        'ABUSE',
        'AD',
        'SPAM',
        'INAPPROPRIATE',
        'ETC'
    ) NOT NULL,

    content VARCHAR(1000) NULL,

    status ENUM(
        'PENDING',
        'REVIEWED',
        'REJECTED',
        'ACCEPTED'
    ) NOT NULL DEFAULT 'PENDING',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME NULL,

    CONSTRAINT fk_post_reports_post
        FOREIGN KEY (post_id)
        REFERENCES community_posts(post_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_post_reports_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,

    INDEX idx_post_reports_post (post_id),
    INDEX idx_post_reports_user (user_id),
    INDEX idx_post_reports_status (status)
);

-- 3. 대댓글
-- 기존 comments 테이블에 부모 댓글을 가리키는 컬럼을 추가합니다.
-- NULL = 일반 댓글
-- 숫자 = 해당 comment_id의 대댓글

ALTER TABLE comments
ADD COLUMN IF NOT EXISTS parent_comment_id BIGINT NULL;

-- 기존 데이터가 있다면 자기 자신을 부모로 가리키지 않도록 애플리케이션에서 검증해야 합니다.
-- MySQL 환경에 따라 아래 FK는 별도 실행하는 것을 권장합니다.
ALTER TABLE comments
ADD CONSTRAINT fk_comments_parent
    FOREIGN KEY (parent_comment_id)
    REFERENCES comments(comment_id)
    ON DELETE CASCADE;

CREATE INDEX idx_comments_parent
    ON comments(parent_comment_id);

-- 4. 대댓글 조회 예시
-- 일반 댓글:
-- WHERE parent_comment_id IS NULL
--
-- 특정 댓글의 대댓글:
-- WHERE parent_comment_id = 10;
