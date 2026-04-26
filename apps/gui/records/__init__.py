"""レコード永続層の操作（表示名・リネームのカスケード・削除と stale 参照の報告）。"""

from .lifecycle import cascade_rename, delete_entity, update_record_display_name

__all__ = ["cascade_rename", "delete_entity", "update_record_display_name"]
