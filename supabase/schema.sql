-- MORNING TW — Comments Table
CREATE TABLE IF NOT EXISTS comments (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_id    text NOT NULL,
  nickname   text NOT NULL CHECK (char_length(nickname) >= 1 AND char_length(nickname) <= 20),
  content    text NOT NULL CHECK (char_length(content) >= 1 AND char_length(content) <= 300),
  rating     integer NOT NULL DEFAULT 5 CHECK (rating >= 1 AND rating <= 5),
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Policy: 任何人都可以讀留言
CREATE POLICY "public_read" ON comments
  FOR SELECT USING (true);

-- Policy: 任何人都可以新增留言（匿名）
CREATE POLICY "public_insert" ON comments
  FOR INSERT WITH CHECK (
    char_length(nickname) >= 1 AND
    char_length(content)  >= 1
  );
