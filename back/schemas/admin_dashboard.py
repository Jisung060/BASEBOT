from pydantic import BaseModel


class AdminDashboardStatsResponse(BaseModel):
    total_users: int
    today_users: int
    total_posts: int
    pending_reports: int
    today_games: int
    prediction_participation: int