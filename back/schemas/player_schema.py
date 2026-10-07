from typing import Optional
from pydantic import BaseModel

# 선수 시즌 스탯 응답 스키마
class PlayerSeasonStatResponse(BaseModel):
    season: int
    is_pitcher: bool
    games: int
    batting_avg: Optional[float] = None
    hits: int
    home_runs: int
    rbi: int
    bwar: Optional[float] = None
    avg_exit_velocity: Optional[float] = None
    barrel_percentage: Optional[float] = None
    hard_hit_percentage: Optional[float] = None

    class Config:
        from_attributes = True

# 선수 목록 조회용 요약 정보 스키마
class PlayerSummaryResponse(BaseModel):
    player_id: int
    player_name: str
    headshot_url: Optional[str] = None
    team_id: Optional[int] = None
    team_name: Optional[str] = None
    team_code: Optional[str] = None
    games: Optional[int] = 0
    batting_avg: Optional[float] = None
    home_runs: Optional[int] = 0
    rbi: Optional[int] = 0
    bwar: Optional[float] = None
    avg_exit_velocity: Optional[float] = None

# 선수 상세 페이지용 응답 스키마
class PlayerDetailResponse(BaseModel):
    player_id: int
    player_name: str
    headshot_url: Optional[str] = None
    team_id: Optional[int] = None
    team_name: Optional[str] = None
    team_code: Optional[str] = None
    stats: list[PlayerSeasonStatResponse] = []