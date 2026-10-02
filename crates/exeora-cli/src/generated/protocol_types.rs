/// Error types.
pub mod error {
    /// Error from a `TryFrom` or `FromStr` implementation.
    pub struct ConversionError(::std::borrow::Cow<'static, str>);
    impl ::std::error::Error for ConversionError {}
    impl ::std::fmt::Display for ConversionError {
        fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> Result<(), ::std::fmt::Error> {
            ::std::fmt::Display::fmt(&self.0, f)
        }
    }
    impl ::std::fmt::Debug for ConversionError {
        fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> Result<(), ::std::fmt::Error> {
            ::std::fmt::Debug::fmt(&self.0, f)
        }
    }
    impl From<&'static str> for ConversionError {
        fn from(value: &'static str) -> Self {
            Self(value.into())
        }
    }
    impl From<String> for ConversionError {
        fn from(value: String) -> Self {
            Self(value.into())
        }
    }
}
///`ExeoraProtocolTypes`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "title": "ExeoraProtocolTypes",
///  "type": "object",
///  "required": [
///    "cloudCliConfig",
///    "commandPolicy",
///    "executorMessage",
///    "localCommandPolicy",
///    "relayMessage"
///  ],
///  "properties": {
///    "cloudCliConfig": {
///      "type": "object",
///      "required": [
///        "deviceId",
///        "deviceName",
///        "gatewayUrl",
///        "projects",
///        "workspaceRoot",
///        "workspaces"
///      ],
///      "properties": {
///        "deviceId": {
///          "type": "string",
///          "minLength": 1
///        },
///        "deviceName": {
///          "type": "string",
///          "minLength": 1
///        },
///        "gatewayUrl": {
///          "type": "string",
///          "format": "uri"
///        },
///        "projects": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "id",
///              "name",
///              "root",
///              "slug"
///            ],
///            "properties": {
///              "id": {
///                "type": "string",
///                "minLength": 1
///              },
///              "name": {
///                "type": "string",
///                "minLength": 1
///              },
///              "root": {
///                "type": "string",
///                "minLength": 1
///              },
///              "slug": {
///                "type": "string",
///                "minLength": 1
///              }
///            },
///            "additionalProperties": false
///          }
///        },
///        "workspaceRoot": {
///          "type": "string",
///          "minLength": 1
///        },
///        "workspaces": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "branch",
///              "gitRoot",
///              "id",
///              "managed",
///              "name",
///              "projectId",
///              "root",
///              "slug",
///              "syncState"
///            ],
///            "properties": {
///              "branch": {
///                "anyOf": [
///                  {
///                    "type": "string"
///                  },
///                  {
///                    "type": "null"
///                  }
///                ]
///              },
///              "gitRoot": {
///                "type": "string",
///                "minLength": 1
///              },
///              "id": {
///                "type": "string",
///                "minLength": 1
///              },
///              "managed": {
///                "type": "boolean"
///              },
///              "name": {
///                "type": "string",
///                "minLength": 1
///              },
///              "projectId": {
///                "type": "string",
///                "minLength": 1
///              },
///              "root": {
///                "type": "string",
///                "minLength": 1
///              },
///              "slug": {
///                "type": "string",
///                "minLength": 1
///              },
///              "syncState": {
///                "type": "string",
///                "enum": [
///                  "pendingUpsert",
///                  "active",
///                  "pendingDelete",
///                  "disabled",
///                  "removing"
///                ]
///              }
///            },
///            "additionalProperties": false
///          }
///        }
///      },
///      "additionalProperties": false,
///      "$schema": "https://json-schema.org/draft/2020-12/schema"
///    },
///    "commandPolicy": {
///      "type": "object",
///      "required": [
///        "allow",
///        "approve",
///        "deny",
///        "mode",
///        "shell",
///        "tools"
///      ],
///      "properties": {
///        "allow": {
///          "default": [],
///          "type": "array",
///          "items": {
///            "type": "string"
///          }
///        },
///        "approve": {
///          "default": false,
///          "type": "boolean"
///        },
///        "deny": {
///          "default": [],
///          "type": "array",
///          "items": {
///            "type": "string"
///          }
///        },
///        "mode": {
///          "type": "string",
///          "enum": [
///            "allow_all",
///            "allow_list",
///            "read_only"
///          ]
///        },
///        "shell": {
///          "default": false,
///          "type": "boolean"
///        },
///        "tools": {
///          "default": null,
///          "anyOf": [
///            {
///              "type": "array",
///              "items": {
///                "type": "string",
///                "enum": [
///                  "read_file",
///                  "list_files",
///                  "grep",
///                  "edit_file",
///                  "write_file",
///                  "apply_patch",
///                  "list_git_workspaces",
///                  "create_workspace",
///                  "attach_workspace",
///                  "detach_workspace",
///                  "remove_workspace",
///                  "run_command",
///                  "start_command",
///                  "get_command_output",
///                  "send_command_input",
///                  "kill_command",
///                  "list_skills"
///                ]
///              }
///            },
///            {
///              "type": "null"
///            }
///          ]
///        }
///      },
///      "additionalProperties": false,
///      "$schema": "https://json-schema.org/draft/2020-12/schema"
///    },
///    "executorMessage": {
///      "oneOf": [
///        {
///          "type": "object",
///          "required": [
///            "cliVersion",
///            "deviceId",
///            "platform",
///            "projects",
///            "protocolVersion",
///            "type"
///          ],
///          "properties": {
///            "capabilities": {
///              "type": "object",
///              "required": [
///                "prompt",
///                "tools"
///              ],
///              "properties": {
///                "features": {
///                  "type": "array",
///                  "items": {
///                    "type": "string",
///                    "maxLength": 64
///                  },
///                  "maxItems": 32
///                },
///                "prompt": {
///                  "type": "boolean"
///                },
///                "tools": {
///                  "type": "array",
///                  "items": {
///                    "type": "string",
///                    "maxLength": 64
///                  },
///                  "maxItems": 64
///                },
///                "workspaceRouting": {
///                  "type": "boolean"
///                }
///              },
///              "additionalProperties": false
///            },
///            "cliVersion": {
///              "type": "string"
///            },
///            "deviceId": {
///              "type": "string"
///            },
///            "platform": {
///              "type": "string"
///            },
///            "projects": {
///              "type": "array",
///              "items": {
///                "type": "object",
///                "required": [
///                  "id",
///                  "slug"
///                ],
///                "properties": {
///                  "id": {
///                    "type": "string"
///                  },
///                  "slug": {
///                    "type": "string"
///                  }
///                },
///                "additionalProperties": false
///              }
///            },
///            "protocolVersion": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": -9007199254740991.0
///            },
///            "type": {
///              "type": "string",
///              "const": "hello"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "type"
///          ],
///          "properties": {
///            "at": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": -9007199254740991.0
///            },
///            "type": {
///              "type": "string",
///              "const": "heartbeat"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "at",
///            "type"
///          ],
///          "properties": {
///            "at": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": -9007199254740991.0
///            },
///            "type": {
///              "type": "string",
///              "const": "presence"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "projectId",
///            "tools",
///            "type"
///          ],
///          "properties": {
///            "projectId": {
///              "type": "string"
///            },
///            "tools": {
///              "type": "array",
///              "items": {
///                "type": "object",
///                "required": [
///                  "exposedName",
///                  "inputSchema",
///                  "name",
///                  "server"
///                ],
///                "properties": {
///                  "annotations": {
///                    "type": "object",
///                    "properties": {
///                      "destructiveHint": {
///                        "type": "boolean"
///                      },
///                      "idempotentHint": {
///                        "type": "boolean"
///                      },
///                      "openWorldHint": {
///                        "type": "boolean"
///                      },
///                      "readOnlyHint": {
///                        "type": "boolean"
///                      }
///                    },
///                    "additionalProperties": false
///                  },
///                  "description": {
///                    "type": "string",
///                    "maxLength": 4096
///                  },
///                  "exposedName": {
///                    "type": "string",
///                    "maxLength": 64,
///                    "minLength": 1,
///                    "pattern": "^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+(?:__[a-f0-9]{10})?$"
///                  },
///                  "inputSchema": {
///                    "type": "object",
///                    "additionalProperties": {},
///                    "propertyNames": {
///                      "type": "string"
///                    }
///                  },
///                  "name": {
///                    "type": "string",
///                    "maxLength": 128,
///                    "minLength": 1
///                  },
///                  "server": {
///                    "type": "string",
///                    "maxLength": 64,
///                    "minLength": 1
///                  },
///                  "title": {
///                    "type": "string",
///                    "maxLength": 512
///                  }
///                },
///                "additionalProperties": false
///              },
///              "maxItems": 256
///            },
///            "type": {
///              "type": "string",
///              "const": "mcp.catalog"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "durationMs",
///            "requestId",
///            "result",
///            "type"
///          ],
///          "properties": {
///            "durationMs": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": -9007199254740991.0
///            },
///            "requestId": {
///              "type": "string"
///            },
///            "result": {
///              "oneOf": [
///                {
///                  "type": "object",
///                  "required": [
///                    "ok",
///                    "value"
///                  ],
///                  "properties": {
///                    "ok": {
///                      "type": "boolean",
///                      "const": true
///                    },
///                    "value": {}
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "error",
///                    "ok"
///                  ],
///                  "properties": {
///                    "error": {
///                      "type": "object",
///                      "required": [
///                        "code",
///                        "message"
///                      ],
///                      "properties": {
///                        "code": {
///                          "type": "string",
///                          "enum": [
///                            "LOCAL_EXECUTOR_OFFLINE",
///                            "EXECUTOR_WAKING",
///                            "TOOL_TIMEOUT",
///                            "CANCELLED",
///                            "PATH_ESCAPE",
///                            "PATH_NOT_FOUND",
///                            "TOOL_FAILED",
///                            "INVALID_ARGUMENTS",
///                            "UNKNOWN_TOOL",
///                            "UNKNOWN_PROJECT",
///                            "UNKNOWN_WORKSPACE",
///                            "WORKSPACE_UNAVAILABLE",
///                            "UNKNOWN_PROCESS",
///                            "NO_ACTIVE_PROJECT",
///                            "FORBIDDEN",
///                            "APPROVAL_DECLINED",
///                            "APPROVAL_TIMEOUT",
///                            "INTERNAL_ERROR"
///                          ]
///                        },
///                        "message": {
///                          "type": "string"
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    "ok": {
///                      "type": "boolean",
///                      "const": false
///                    }
///                  },
///                  "additionalProperties": false
///                }
///              ]
///            },
///            "type": {
///              "type": "string",
///              "const": "tool.result"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "durationMs",
///            "requestId",
///            "result",
///            "type"
///          ],
///          "properties": {
///            "durationMs": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": -9007199254740991.0
///            },
///            "requestId": {
///              "type": "string"
///            },
///            "result": {
///              "oneOf": [
///                {
///                  "type": "object",
///                  "required": [
///                    "ok",
///                    "value"
///                  ],
///                  "properties": {
///                    "ok": {
///                      "type": "boolean",
///                      "const": true
///                    },
///                    "value": {}
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "error",
///                    "ok"
///                  ],
///                  "properties": {
///                    "error": {
///                      "type": "object",
///                      "required": [
///                        "code",
///                        "message"
///                      ],
///                      "properties": {
///                        "code": {
///                          "type": "string",
///                          "enum": [
///                            "LOCAL_EXECUTOR_OFFLINE",
///                            "EXECUTOR_WAKING",
///                            "TOOL_TIMEOUT",
///                            "CANCELLED",
///                            "PATH_ESCAPE",
///                            "PATH_NOT_FOUND",
///                            "TOOL_FAILED",
///                            "INVALID_ARGUMENTS",
///                            "UNKNOWN_TOOL",
///                            "UNKNOWN_PROJECT",
///                            "UNKNOWN_WORKSPACE",
///                            "WORKSPACE_UNAVAILABLE",
///                            "UNKNOWN_PROCESS",
///                            "NO_ACTIVE_PROJECT",
///                            "FORBIDDEN",
///                            "APPROVAL_DECLINED",
///                            "APPROVAL_TIMEOUT",
///                            "INTERNAL_ERROR"
///                          ]
///                        },
///                        "message": {
///                          "type": "string"
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    "ok": {
///                      "type": "boolean",
///                      "const": false
///                    }
///                  },
///                  "additionalProperties": false
///                }
///              ]
///            },
///            "type": {
///              "type": "string",
///              "const": "mcp.result"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "durationMs",
///            "requestId",
///            "result",
///            "type"
///          ],
///          "properties": {
///            "durationMs": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": -9007199254740991.0
///            },
///            "requestId": {
///              "type": "string"
///            },
///            "result": {
///              "oneOf": [
///                {
///                  "type": "object",
///                  "required": [
///                    "ok",
///                    "value"
///                  ],
///                  "properties": {
///                    "ok": {
///                      "type": "boolean",
///                      "const": true
///                    },
///                    "value": {
///                      "oneOf": [
///                        {
///                          "type": "object",
///                          "required": [
///                            "ahead",
///                            "behind",
///                            "branches",
///                            "files",
///                            "gitWorkspaces",
///                            "head",
///                            "kind",
///                            "oid",
///                            "operation",
///                            "remotes",
///                            "repository",
///                            "stashes",
///                            "upstream"
///                          ],
///                          "properties": {
///                            "ahead": {
///                              "type": "integer",
///                              "maximum": 9007199254740991.0,
///                              "minimum": 0.0
///                            },
///                            "behind": {
///                              "type": "integer",
///                              "maximum": 9007199254740991.0,
///                              "minimum": 0.0
///                            },
///                            "branches": {
///                              "type": "array",
///                              "items": {
///                                "type": "object",
///                                "required": [
///                                  "ahead",
///                                  "current",
///                                  "name",
///                                  "remote",
///                                  "shortOid",
///                                  "upstream"
///                                ],
///                                "properties": {
///                                  "ahead": {
///                                    "default": null,
///                                    "anyOf": [
///                                      {
///                                        "type": "integer",
///                                        "maximum": 9007199254740991.0,
///                                        "minimum": 0.0
///                                      },
///                                      {
///                                        "type": "null"
///                                      }
///                                    ]
///                                  },
///                                  "current": {
///                                    "type": "boolean"
///                                  },
///                                  "name": {
///                                    "type": "string"
///                                  },
///                                  "remote": {
///                                    "type": "boolean"
///                                  },
///                                  "shortOid": {
///                                    "type": "string"
///                                  },
///                                  "upstream": {
///                                    "anyOf": [
///                                      {
///                                        "type": "string"
///                                      },
///                                      {
///                                        "type": "null"
///                                      }
///                                    ]
///                                  }
///                                },
///                                "additionalProperties": false
///                              }
///                            },
///                            "files": {
///                              "type": "array",
///                              "items": {
///                                "type": "object",
///                                "required": [
///                                  "index",
///                                  "kind",
///                                  "path",
///                                  "submodule",
///                                  "worktree"
///                                ],
///                                "properties": {
///                                  "index": {
///                                    "type": "string",
///                                    "maxLength": 1,
///                                    "minLength": 1
///                                  },
///                                  "kind": {
///                                    "type": "string",
///                                    "enum": [
///                                      "tracked",
///                                      "untracked",
///                                      "conflict"
///                                    ]
///                                  },
///                                  "originalPath": {
///                                    "anyOf": [
///                                      {
///                                        "type": "string",
///                                        "maxLength": 4096,
///                                        "minLength": 1
///                                      },
///                                      {
///                                        "type": "null"
///                                      }
///                                    ]
///                                  },
///                                  "path": {
///                                    "type": "string",
///                                    "maxLength": 4096,
///                                    "minLength": 1
///                                  },
///                                  "submodule": {
///                                    "type": "boolean"
///                                  },
///                                  "worktree": {
///                                    "type": "string",
///                                    "maxLength": 1,
///                                    "minLength": 1
///                                  }
///                                },
///                                "additionalProperties": false
///                              }
///                            },
///                            "gitWorkspaces": {
///                              "default": [],
///                              "type": "array",
///                              "items": {
///                                "type": "object",
///                                "required": [
///                                  "branch",
///                                  "path"
///                                ],
///                                "properties": {
///                                  "branch": {
///                                    "anyOf": [
///                                      {
///                                        "type": "string"
///                                      },
///                                      {
///                                        "type": "null"
///                                      }
///                                    ]
///                                  },
///                                  "path": {
///                                    "type": "string"
///                                  }
///                                },
///                                "additionalProperties": false
///                              }
///                            },
///                            "head": {
///                              "anyOf": [
///                                {
///                                  "type": "string"
///                                },
///                                {
///                                  "type": "null"
///                                }
///                              ]
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "status"
///                            },
///                            "oid": {
///                              "anyOf": [
///                                {
///                                  "type": "string"
///                                },
///                                {
///                                  "type": "null"
///                                }
///                              ]
///                            },
///                            "operation": {
///                              "anyOf": [
///                                {
///                                  "type": "string",
///                                  "enum": [
///                                    "merge",
///                                    "rebase",
///                                    "cherry-pick",
///                                    "revert",
///                                    "bisect"
///                                  ]
///                                },
///                                {
///                                  "type": "null"
///                                }
///                              ]
///                            },
///                            "remotes": {
///                              "type": "array",
///                              "items": {
///                                "type": "string"
///                              }
///                            },
///                            "repository": {
///                              "type": "boolean"
///                            },
///                            "stashes": {
///                              "default": 0,
///                              "type": "integer",
///                              "maximum": 9007199254740991.0,
///                              "minimum": 0.0
///                            },
///                            "upstream": {
///                              "anyOf": [
///                                {
///                                  "type": "string"
///                                },
///                                {
///                                  "type": "null"
///                                }
///                              ]
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "area",
///                            "binary",
///                            "kind",
///                            "patch",
///                            "path",
///                            "truncated"
///                          ],
///                          "properties": {
///                            "area": {
///                              "type": "string",
///                              "enum": [
///                                "working",
///                                "staged"
///                              ]
///                            },
///                            "binary": {
///                              "type": "boolean"
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "diff"
///                            },
///                            "patch": {
///                              "type": "string"
///                            },
///                            "path": {
///                              "type": "string",
///                              "maxLength": 4096,
///                              "minLength": 1
///                            },
///                            "truncated": {
///                              "type": "boolean"
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "kind",
///                            "status",
///                            "stderr",
///                            "stdout"
///                          ],
///                          "properties": {
///                            "kind": {
///                              "type": "string",
///                              "const": "mutation"
///                            },
///                            "status": {
///                              "type": "object",
///                              "required": [
///                                "ahead",
///                                "behind",
///                                "branches",
///                                "files",
///                                "gitWorkspaces",
///                                "head",
///                                "kind",
///                                "oid",
///                                "operation",
///                                "remotes",
///                                "repository",
///                                "stashes",
///                                "upstream"
///                              ],
///                              "properties": {
///                                "ahead": {
///                                  "type": "integer",
///                                  "maximum": 9007199254740991.0,
///                                  "minimum": 0.0
///                                },
///                                "behind": {
///                                  "type": "integer",
///                                  "maximum": 9007199254740991.0,
///                                  "minimum": 0.0
///                                },
///                                "branches": {
///                                  "type": "array",
///                                  "items": {
///                                    "type": "object",
///                                    "required": [
///                                      "ahead",
///                                      "current",
///                                      "name",
///                                      "remote",
///                                      "shortOid",
///                                      "upstream"
///                                    ],
///                                    "properties": {
///                                      "ahead": {
///                                        "default": null,
///                                        "anyOf": [
///                                          {
///                                            "type": "integer",
///                                            "maximum": 9007199254740991.0,
///                                            "minimum": 0.0
///                                          },
///                                          {
///                                            "type": "null"
///                                          }
///                                        ]
///                                      },
///                                      "current": {
///                                        "type": "boolean"
///                                      },
///                                      "name": {
///                                        "type": "string"
///                                      },
///                                      "remote": {
///                                        "type": "boolean"
///                                      },
///                                      "shortOid": {
///                                        "type": "string"
///                                      },
///                                      "upstream": {
///                                        "anyOf": [
///                                          {
///                                            "type": "string"
///                                          },
///                                          {
///                                            "type": "null"
///                                          }
///                                        ]
///                                      }
///                                    },
///                                    "additionalProperties": false
///                                  }
///                                },
///                                "files": {
///                                  "type": "array",
///                                  "items": {
///                                    "type": "object",
///                                    "required": [
///                                      "index",
///                                      "kind",
///                                      "path",
///                                      "submodule",
///                                      "worktree"
///                                    ],
///                                    "properties": {
///                                      "index": {
///                                        "type": "string",
///                                        "maxLength": 1,
///                                        "minLength": 1
///                                      },
///                                      "kind": {
///                                        "type": "string",
///                                        "enum": [
///                                          "tracked",
///                                          "untracked",
///                                          "conflict"
///                                        ]
///                                      },
///                                      "originalPath": {
///                                        "anyOf": [
///                                          {
///                                            "type": "string",
///                                            "maxLength": 4096,
///                                            "minLength": 1
///                                          },
///                                          {
///                                            "type": "null"
///                                          }
///                                        ]
///                                      },
///                                      "path": {
///                                        "type": "string",
///                                        "maxLength": 4096,
///                                        "minLength": 1
///                                      },
///                                      "submodule": {
///                                        "type": "boolean"
///                                      },
///                                      "worktree": {
///                                        "type": "string",
///                                        "maxLength": 1,
///                                        "minLength": 1
///                                      }
///                                    },
///                                    "additionalProperties": false
///                                  }
///                                },
///                                "gitWorkspaces": {
///                                  "default": [],
///                                  "type": "array",
///                                  "items": {
///                                    "type": "object",
///                                    "required": [
///                                      "branch",
///                                      "path"
///                                    ],
///                                    "properties": {
///                                      "branch": {
///                                        "anyOf": [
///                                          {
///                                            "type": "string"
///                                          },
///                                          {
///                                            "type": "null"
///                                          }
///                                        ]
///                                      },
///                                      "path": {
///                                        "type": "string"
///                                      }
///                                    },
///                                    "additionalProperties": false
///                                  }
///                                },
///                                "head": {
///                                  "anyOf": [
///                                    {
///                                      "type": "string"
///                                    },
///                                    {
///                                      "type": "null"
///                                    }
///                                  ]
///                                },
///                                "kind": {
///                                  "type": "string",
///                                  "const": "status"
///                                },
///                                "oid": {
///                                  "anyOf": [
///                                    {
///                                      "type": "string"
///                                    },
///                                    {
///                                      "type": "null"
///                                    }
///                                  ]
///                                },
///                                "operation": {
///                                  "anyOf": [
///                                    {
///                                      "type": "string",
///                                      "enum": [
///                                        "merge",
///                                        "rebase",
///                                        "cherry-pick",
///                                        "revert",
///                                        "bisect"
///                                      ]
///                                    },
///                                    {
///                                      "type": "null"
///                                    }
///                                  ]
///                                },
///                                "remotes": {
///                                  "type": "array",
///                                  "items": {
///                                    "type": "string"
///                                  }
///                                },
///                                "repository": {
///                                  "type": "boolean"
///                                },
///                                "stashes": {
///                                  "default": 0,
///                                  "type": "integer",
///                                  "maximum": 9007199254740991.0,
///                                  "minimum": 0.0
///                                },
///                                "upstream": {
///                                  "anyOf": [
///                                    {
///                                      "type": "string"
///                                    },
///                                    {
///                                      "type": "null"
///                                    }
///                                  ]
///                                }
///                              },
///                              "additionalProperties": false
///                            },
///                            "stderr": {
///                              "type": "string"
///                            },
///                            "stdout": {
///                              "type": "string"
///                            },
///                            "workspace": {
///                              "type": "object",
///                              "required": [
///                                "branch",
///                                "id",
///                                "localPath",
///                                "name",
///                                "slug"
///                              ],
///                              "properties": {
///                                "branch": {
///                                  "anyOf": [
///                                    {
///                                      "type": "string"
///                                    },
///                                    {
///                                      "type": "null"
///                                    }
///                                  ]
///                                },
///                                "id": {
///                                  "type": "string",
///                                  "minLength": 1
///                                },
///                                "localPath": {
///                                  "type": "string",
///                                  "minLength": 1
///                                },
///                                "name": {
///                                  "type": "string",
///                                  "minLength": 1
///                                },
///                                "slug": {
///                                  "type": "string",
///                                  "minLength": 1
///                                }
///                              },
///                              "additionalProperties": false
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "clean",
///                            "kind",
///                            "reasons"
///                          ],
///                          "properties": {
///                            "clean": {
///                              "type": "boolean"
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "unpublished"
///                            },
///                            "reasons": {
///                              "type": "array",
///                              "items": {
///                                "type": "string",
///                                "maxLength": 512
///                              },
///                              "maxItems": 200
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "adopted",
///                            "branch",
///                            "kind",
///                            "localPath"
///                          ],
///                          "properties": {
///                            "adopted": {
///                              "type": "boolean"
///                            },
///                            "branch": {
///                              "anyOf": [
///                                {
///                                  "type": "string"
///                                },
///                                {
///                                  "type": "null"
///                                }
///                              ]
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "prepared"
///                            },
///                            "localPath": {
///                              "type": "string",
///                              "minLength": 1
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "commits",
///                            "head",
///                            "kind",
///                            "nextCursor",
///                            "upstream"
///                          ],
///                          "properties": {
///                            "commits": {
///                              "type": "array",
///                              "items": {
///                                "type": "object",
///                                "required": [
///                                  "authorEmail",
///                                  "authorName",
///                                  "authoredAt",
///                                  "committedAt",
///                                  "oid",
///                                  "parents",
///                                  "refs",
///                                  "shortOid",
///                                  "subject"
///                                ],
///                                "properties": {
///                                  "authorEmail": {
///                                    "type": "string"
///                                  },
///                                  "authorName": {
///                                    "type": "string"
///                                  },
///                                  "authoredAt": {
///                                    "type": "string"
///                                  },
///                                  "committedAt": {
///                                    "type": "string"
///                                  },
///                                  "oid": {
///                                    "type": "string"
///                                  },
///                                  "parents": {
///                                    "type": "array",
///                                    "items": {
///                                      "type": "string"
///                                    }
///                                  },
///                                  "refs": {
///                                    "type": "array",
///                                    "items": {
///                                      "type": "string"
///                                    }
///                                  },
///                                  "shortOid": {
///                                    "type": "string"
///                                  },
///                                  "subject": {
///                                    "type": "string"
///                                  }
///                                },
///                                "additionalProperties": false
///                              }
///                            },
///                            "head": {
///                              "anyOf": [
///                                {
///                                  "type": "string"
///                                },
///                                {
///                                  "type": "null"
///                                }
///                              ]
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "log"
///                            },
///                            "nextCursor": {
///                              "anyOf": [
///                                {
///                                  "type": "string"
///                                },
///                                {
///                                  "type": "null"
///                                }
///                              ]
///                            },
///                            "upstream": {
///                              "anyOf": [
///                                {
///                                  "type": "string"
///                                },
///                                {
///                                  "type": "null"
///                                }
///                              ]
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "files",
///                            "kind",
///                            "message",
///                            "oid"
///                          ],
///                          "properties": {
///                            "files": {
///                              "type": "array",
///                              "items": {
///                                "type": "object",
///                                "required": [
///                                  "additions",
///                                  "binary",
///                                  "deletions",
///                                  "path",
///                                  "status"
///                                ],
///                                "properties": {
///                                  "additions": {
///                                    "type": "integer",
///                                    "maximum": 9007199254740991.0,
///                                    "minimum": 0.0
///                                  },
///                                  "binary": {
///                                    "type": "boolean"
///                                  },
///                                  "deletions": {
///                                    "type": "integer",
///                                    "maximum": 9007199254740991.0,
///                                    "minimum": 0.0
///                                  },
///                                  "oldPath": {
///                                    "type": "string"
///                                  },
///                                  "path": {
///                                    "type": "string"
///                                  },
///                                  "status": {
///                                    "type": "string",
///                                    "enum": [
///                                      "A",
///                                      "M",
///                                      "D",
///                                      "R",
///                                      "C",
///                                      "T"
///                                    ]
///                                  }
///                                },
///                                "additionalProperties": false
///                              }
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "commit_detail"
///                            },
///                            "message": {
///                              "type": "string"
///                            },
///                            "oid": {
///                              "type": "string"
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "binary",
///                            "kind",
///                            "oid",
///                            "patch",
///                            "path",
///                            "truncated"
///                          ],
///                          "properties": {
///                            "binary": {
///                              "type": "boolean"
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "commit_diff"
///                            },
///                            "oid": {
///                              "type": "string"
///                            },
///                            "patch": {
///                              "type": "string"
///                            },
///                            "path": {
///                              "anyOf": [
///                                {
///                                  "type": "string"
///                                },
///                                {
///                                  "type": "null"
///                                }
///                              ]
///                            },
///                            "truncated": {
///                              "type": "boolean"
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "area",
///                            "kind",
///                            "patch",
///                            "truncated",
///                            "untrackedOmitted"
///                          ],
///                          "properties": {
///                            "area": {
///                              "type": "string",
///                              "enum": [
///                                "working",
///                                "staged"
///                              ]
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "diff_all"
///                            },
///                            "patch": {
///                              "type": "string"
///                            },
///                            "truncated": {
///                              "type": "boolean"
///                            },
///                            "untrackedOmitted": {
///                              "type": "boolean"
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "base",
///                            "files",
///                            "head",
///                            "kind",
///                            "mergeBase",
///                            "patch",
///                            "truncated"
///                          ],
///                          "properties": {
///                            "base": {
///                              "type": "string"
///                            },
///                            "files": {
///                              "type": "array",
///                              "items": {
///                                "type": "object",
///                                "required": [
///                                  "additions",
///                                  "binary",
///                                  "deletions",
///                                  "path",
///                                  "status"
///                                ],
///                                "properties": {
///                                  "additions": {
///                                    "type": "integer",
///                                    "maximum": 9007199254740991.0,
///                                    "minimum": 0.0
///                                  },
///                                  "binary": {
///                                    "type": "boolean"
///                                  },
///                                  "deletions": {
///                                    "type": "integer",
///                                    "maximum": 9007199254740991.0,
///                                    "minimum": 0.0
///                                  },
///                                  "oldPath": {
///                                    "type": "string"
///                                  },
///                                  "path": {
///                                    "type": "string"
///                                  },
///                                  "status": {
///                                    "type": "string",
///                                    "enum": [
///                                      "A",
///                                      "M",
///                                      "D",
///                                      "R",
///                                      "C",
///                                      "T"
///                                    ]
///                                  }
///                                },
///                                "additionalProperties": false
///                              }
///                            },
///                            "head": {
///                              "type": "string"
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "range_diff"
///                            },
///                            "mergeBase": {
///                              "type": "string"
///                            },
///                            "patch": {
///                              "type": "string"
///                            },
///                            "truncated": {
///                              "type": "boolean"
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "branch",
///                            "files",
///                            "kind",
///                            "patch",
///                            "truncated"
///                          ],
///                          "properties": {
///                            "branch": {
///                              "anyOf": [
///                                {
///                                  "type": "string"
///                                },
///                                {
///                                  "type": "null"
///                                }
///                              ]
///                            },
///                            "files": {
///                              "type": "array",
///                              "items": {
///                                "type": "object",
///                                "required": [
///                                  "additions",
///                                  "binary",
///                                  "deletions",
///                                  "path",
///                                  "status"
///                                ],
///                                "properties": {
///                                  "additions": {
///                                    "type": "integer",
///                                    "maximum": 9007199254740991.0,
///                                    "minimum": 0.0
///                                  },
///                                  "binary": {
///                                    "type": "boolean"
///                                  },
///                                  "deletions": {
///                                    "type": "integer",
///                                    "maximum": 9007199254740991.0,
///                                    "minimum": 0.0
///                                  },
///                                  "oldPath": {
///                                    "type": "string"
///                                  },
///                                  "path": {
///                                    "type": "string"
///                                  },
///                                  "status": {
///                                    "type": "string",
///                                    "enum": [
///                                      "A",
///                                      "M",
///                                      "D",
///                                      "R",
///                                      "C",
///                                      "T"
///                                    ]
///                                  }
///                                },
///                                "additionalProperties": false
///                              }
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "staged_context"
///                            },
///                            "patch": {
///                              "type": "string"
///                            },
///                            "truncated": {
///                              "type": "boolean"
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "base",
///                            "commits",
///                            "files",
///                            "head",
///                            "kind",
///                            "mergeBase",
///                            "patch",
///                            "truncated"
///                          ],
///                          "properties": {
///                            "base": {
///                              "type": "string"
///                            },
///                            "commits": {
///                              "type": "array",
///                              "items": {
///                                "type": "object",
///                                "required": [
///                                  "author",
///                                  "body",
///                                  "oid",
///                                  "subject"
///                                ],
///                                "properties": {
///                                  "author": {
///                                    "type": "string"
///                                  },
///                                  "body": {
///                                    "type": "string"
///                                  },
///                                  "oid": {
///                                    "type": "string"
///                                  },
///                                  "subject": {
///                                    "type": "string"
///                                  }
///                                },
///                                "additionalProperties": false
///                              },
///                              "maxItems": 40
///                            },
///                            "files": {
///                              "type": "array",
///                              "items": {
///                                "type": "object",
///                                "required": [
///                                  "additions",
///                                  "binary",
///                                  "deletions",
///                                  "path",
///                                  "status"
///                                ],
///                                "properties": {
///                                  "additions": {
///                                    "type": "integer",
///                                    "maximum": 9007199254740991.0,
///                                    "minimum": 0.0
///                                  },
///                                  "binary": {
///                                    "type": "boolean"
///                                  },
///                                  "deletions": {
///                                    "type": "integer",
///                                    "maximum": 9007199254740991.0,
///                                    "minimum": 0.0
///                                  },
///                                  "oldPath": {
///                                    "type": "string"
///                                  },
///                                  "path": {
///                                    "type": "string"
///                                  },
///                                  "status": {
///                                    "type": "string",
///                                    "enum": [
///                                      "A",
///                                      "M",
///                                      "D",
///                                      "R",
///                                      "C",
///                                      "T"
///                                    ]
///                                  }
///                                },
///                                "additionalProperties": false
///                              }
///                            },
///                            "head": {
///                              "type": "string"
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "range_context"
///                            },
///                            "mergeBase": {
///                              "type": "string"
///                            },
///                            "patch": {
///                              "type": "string"
///                            },
///                            "truncated": {
///                              "type": "boolean"
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "entries",
///                            "kind"
///                          ],
///                          "properties": {
///                            "entries": {
///                              "type": "array",
///                              "items": {
///                                "type": "object",
///                                "required": [
///                                  "createdAt",
///                                  "index",
///                                  "message"
///                                ],
///                                "properties": {
///                                  "createdAt": {
///                                    "type": "string"
///                                  },
///                                  "index": {
///                                    "type": "integer",
///                                    "maximum": 9007199254740991.0,
///                                    "minimum": 0.0
///                                  },
///                                  "message": {
///                                    "type": "string"
///                                  }
///                                },
///                                "additionalProperties": false
///                              }
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "stash_list"
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "entries",
///                            "kind",
///                            "path",
///                            "truncated"
///                          ],
///                          "properties": {
///                            "entries": {
///                              "type": "array",
///                              "items": {
///                                "type": "object",
///                                "required": [
///                                  "ignored",
///                                  "name",
///                                  "path",
///                                  "type"
///                                ],
///                                "properties": {
///                                  "ignored": {
///                                    "type": "boolean"
///                                  },
///                                  "name": {
///                                    "type": "string"
///                                  },
///                                  "path": {
///                                    "type": "string"
///                                  },
///                                  "size": {
///                                    "type": "integer",
///                                    "maximum": 9007199254740991.0,
///                                    "minimum": 0.0
///                                  },
///                                  "type": {
///                                    "type": "string",
///                                    "enum": [
///                                      "file",
///                                      "directory",
///                                      "symlink"
///                                    ]
///                                  }
///                                },
///                                "additionalProperties": false
///                              }
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "tree"
///                            },
///                            "path": {
///                              "type": "string"
///                            },
///                            "truncated": {
///                              "type": "boolean"
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "binary",
///                            "content",
///                            "encoding",
///                            "kind",
///                            "mime",
///                            "path",
///                            "size",
///                            "token",
///                            "truncated"
///                          ],
///                          "properties": {
///                            "binary": {
///                              "type": "boolean"
///                            },
///                            "content": {
///                              "type": "string"
///                            },
///                            "encoding": {
///                              "type": "string",
///                              "enum": [
///                                "text",
///                                "base64"
///                              ]
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "file"
///                            },
///                            "mime": {
///                              "anyOf": [
///                                {
///                                  "type": "string"
///                                },
///                                {
///                                  "type": "null"
///                                }
///                              ]
///                            },
///                            "path": {
///                              "type": "string"
///                            },
///                            "size": {
///                              "type": "integer",
///                              "maximum": 9007199254740991.0,
///                              "minimum": 0.0
///                            },
///                            "token": {
///                              "type": "string"
///                            },
///                            "truncated": {
///                              "type": "boolean"
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "kind",
///                            "path",
///                            "status",
///                            "token"
///                          ],
///                          "properties": {
///                            "kind": {
///                              "type": "string",
///                              "const": "file_write"
///                            },
///                            "path": {
///                              "type": "string"
///                            },
///                            "status": {
///                              "type": "string",
///                              "enum": [
///                                "written",
///                                "conflict"
///                              ]
///                            },
///                            "token": {
///                              "type": "string"
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "files",
///                            "filesSearched",
///                            "filesSkipped",
///                            "kind",
///                            "totalMatches",
///                            "truncated"
///                          ],
///                          "properties": {
///                            "files": {
///                              "type": "array",
///                              "items": {
///                                "type": "object",
///                                "required": [
///                                  "matches",
///                                  "path",
///                                  "token",
///                                  "truncated"
///                                ],
///                                "properties": {
///                                  "matches": {
///                                    "type": "array",
///                                    "items": {
///                                      "type": "object",
///                                      "required": [
///                                        "column",
///                                        "length",
///                                        "line",
///                                        "preview",
///                                        "previewOffset"
///                                      ],
///                                      "properties": {
///                                        "column": {
///                                          "type": "integer",
///                                          "maximum": 9007199254740991.0,
///                                          "minimum": 1.0
///                                        },
///                                        "length": {
///                                          "type": "integer",
///                                          "maximum": 9007199254740991.0,
///                                          "minimum": 0.0
///                                        },
///                                        "line": {
///                                          "type": "integer",
///                                          "maximum": 9007199254740991.0,
///                                          "minimum": 1.0
///                                        },
///                                        "preview": {
///                                          "type": "string"
///                                        },
///                                        "previewOffset": {
///                                          "type": "integer",
///                                          "maximum": 9007199254740991.0,
///                                          "minimum": 0.0
///                                        }
///                                      },
///                                      "additionalProperties": false
///                                    }
///                                  },
///                                  "path": {
///                                    "type": "string"
///                                  },
///                                  "token": {
///                                    "type": "string"
///                                  },
///                                  "truncated": {
///                                    "type": "boolean"
///                                  }
///                                },
///                                "additionalProperties": false
///                              }
///                            },
///                            "filesSearched": {
///                              "type": "integer",
///                              "maximum": 9007199254740991.0,
///                              "minimum": 0.0
///                            },
///                            "filesSkipped": {
///                              "type": "integer",
///                              "maximum": 9007199254740991.0,
///                              "minimum": 0.0
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "search"
///                            },
///                            "totalMatches": {
///                              "type": "integer",
///                              "maximum": 9007199254740991.0,
///                              "minimum": 0.0
///                            },
///                            "truncated": {
///                              "type": "boolean"
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "files",
///                            "kind",
///                            "replaced",
///                            "skipped"
///                          ],
///                          "properties": {
///                            "files": {
///                              "type": "array",
///                              "items": {
///                                "type": "object",
///                                "required": [
///                                  "path",
///                                  "replaced",
///                                  "status"
///                                ],
///                                "properties": {
///                                  "path": {
///                                    "type": "string"
///                                  },
///                                  "replaced": {
///                                    "type": "integer",
///                                    "maximum": 9007199254740991.0,
///                                    "minimum": 0.0
///                                  },
///                                  "status": {
///                                    "type": "string",
///                                    "enum": [
///                                      "ok",
///                                      "conflict",
///                                      "missing",
///                                      "skipped"
///                                    ]
///                                  }
///                                },
///                                "additionalProperties": false
///                              }
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "replace"
///                            },
///                            "replaced": {
///                              "type": "integer",
///                              "maximum": 9007199254740991.0,
///                              "minimum": 0.0
///                            },
///                            "skipped": {
///                              "type": "integer",
///                              "maximum": 9007199254740991.0,
///                              "minimum": 0.0
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "kind",
///                            "state"
///                          ],
///                          "properties": {
///                            "account": {
///                              "type": "object",
///                              "required": [
///                                "email",
///                                "label",
///                                "newRegistration",
///                                "planUsage",
///                                "scopes"
///                              ],
///                              "properties": {
///                                "email": {
///                                  "anyOf": [
///                                    {
///                                      "type": "string",
///                                      "maxLength": 320,
///                                      "minLength": 1
///                                    },
///                                    {
///                                      "type": "null"
///                                    }
///                                  ]
///                                },
///                                "label": {
///                                  "type": "string",
///                                  "maxLength": 256,
///                                  "minLength": 1
///                                },
///                                "newRegistration": {
///                                  "type": "boolean"
///                                },
///                                "planUsage": {
///                                  "type": "boolean"
///                                },
///                                "scopes": {
///                                  "type": "array",
///                                  "items": {
///                                    "type": "string",
///                                    "maxLength": 128,
///                                    "minLength": 1
///                                  },
///                                  "maxItems": 16
///                                }
///                              },
///                              "additionalProperties": false
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "chatgpt_status"
///                            },
///                            "loginError": {
///                              "type": "string",
///                              "enum": [
///                                "login_timeout",
///                                "state_mismatch",
///                                "plan_disabled",
///                                "missing_code",
///                                "registration_incomplete",
///                                "client_mismatch",
///                                "temporarily_unavailable",
///                                "invalid_token_response",
///                                "invalid_id_token",
///                                "subject_mismatch",
///                                "reconnect",
///                                "client_invalid",
///                                "cancelled"
///                              ]
///                            },
///                            "pending": {
///                              "type": "object",
///                              "required": [
///                                "expiresAt"
///                              ],
///                              "properties": {
///                                "expiresAt": {
///                                  "type": "integer",
///                                  "maximum": 9007199254740991.0,
///                                  "minimum": 0.0
///                                }
///                              },
///                              "additionalProperties": false
///                            },
///                            "state": {
///                              "type": "string",
///                              "enum": [
///                                "signed_out",
///                                "pending",
///                                "ready",
///                                "plan_disabled",
///                                "reconnect",
///                                "client_invalid",
///                                "unavailable_on_cloud"
///                              ]
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "authorizeUrl",
///                            "expiresAt",
///                            "kind"
///                          ],
///                          "properties": {
///                            "authorizeUrl": {
///                              "type": "string",
///                              "format": "uri",
///                              "maxLength": 4096
///                            },
///                            "expiresAt": {
///                              "type": "integer",
///                              "maximum": 9007199254740991.0,
///                              "minimum": 0.0
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "chatgpt_login"
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "kind",
///                            "revocationConfirmed"
///                          ],
///                          "properties": {
///                            "kind": {
///                              "type": "string",
///                              "const": "chatgpt_logout"
///                            },
///                            "revocationConfirmed": {
///                              "type": "boolean"
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "kind",
///                            "models"
///                          ],
///                          "properties": {
///                            "kind": {
///                              "type": "string",
///                              "const": "chatgpt_models"
///                            },
///                            "models": {
///                              "type": "array",
///                              "items": {
///                                "type": "object",
///                                "required": [
///                                  "id",
///                                  "label"
///                                ],
///                                "properties": {
///                                  "id": {
///                                    "type": "string",
///                                    "maxLength": 128,
///                                    "minLength": 1,
///                                    "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$"
///                                  },
///                                  "label": {
///                                    "type": "string",
///                                    "maxLength": 256,
///                                    "minLength": 1
///                                  }
///                                },
///                                "additionalProperties": false
///                              },
///                              "maxItems": 50
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "oneOf": [
///                            {
///                              "type": "object",
///                              "required": [
///                                "kind",
///                                "model",
///                                "outcome",
///                                "text"
///                              ],
///                              "properties": {
///                                "kind": {
///                                  "type": "string",
///                                  "const": "chatgpt_generation"
///                                },
///                                "model": {
///                                  "type": "string",
///                                  "maxLength": 128,
///                                  "minLength": 1,
///                                  "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$"
///                                },
///                                "outcome": {
///                                  "type": "string",
///                                  "const": "completed"
///                                },
///                                "text": {
///                                  "type": "string",
///                                  "maxLength": 200000
///                                }
///                              },
///                              "additionalProperties": false
///                            },
///                            {
///                              "type": "object",
///                              "required": [
///                                "kind",
///                                "outcome",
///                                "reason"
///                              ],
///                              "properties": {
///                                "code": {
///                                  "type": "string",
///                                  "maxLength": 128,
///                                  "minLength": 1
///                                },
///                                "httpStatus": {
///                                  "type": "integer",
///                                  "maximum": 599.0,
///                                  "minimum": 100.0
///                                },
///                                "kind": {
///                                  "type": "string",
///                                  "const": "chatgpt_generation"
///                                },
///                                "outcome": {
///                                  "type": "string",
///                                  "const": "failed"
///                                },
///                                "param": {
///                                  "type": "string",
///                                  "maxLength": 128,
///                                  "minLength": 1
///                                },
///                                "reason": {
///                                  "type": "string",
///                                  "enum": [
///                                    "usage_limit",
///                                    "not_eligible",
///                                    "plan_disabled",
///                                    "reconnect",
///                                    "unsupported",
///                                    "route_not_supported",
///                                    "permission",
///                                    "region_or_policy",
///                                    "temporarily_unavailable",
///                                    "incomplete",
///                                    "interrupted",
///                                    "model_unavailable",
///                                    "signed_out",
///                                    "failed"
///                                  ]
///                                },
///                                "requestId": {
///                                  "type": "string",
///                                  "maxLength": 128,
///                                  "minLength": 1
///                                }
///                              },
///                              "additionalProperties": false
///                            }
///                          ]
///                        }
///                      ]
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "error",
///                    "ok"
///                  ],
///                  "properties": {
///                    "error": {
///                      "type": "object",
///                      "required": [
///                        "code",
///                        "message"
///                      ],
///                      "properties": {
///                        "code": {
///                          "type": "string",
///                          "enum": [
///                            "LOCAL_EXECUTOR_OFFLINE",
///                            "EXECUTOR_WAKING",
///                            "TOOL_TIMEOUT",
///                            "CANCELLED",
///                            "PATH_ESCAPE",
///                            "PATH_NOT_FOUND",
///                            "TOOL_FAILED",
///                            "INVALID_ARGUMENTS",
///                            "UNKNOWN_TOOL",
///                            "UNKNOWN_PROJECT",
///                            "UNKNOWN_WORKSPACE",
///                            "WORKSPACE_UNAVAILABLE",
///                            "UNKNOWN_PROCESS",
///                            "NO_ACTIVE_PROJECT",
///                            "FORBIDDEN",
///                            "APPROVAL_DECLINED",
///                            "APPROVAL_TIMEOUT",
///                            "INTERNAL_ERROR"
///                          ]
///                        },
///                        "message": {
///                          "type": "string"
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    "ok": {
///                      "type": "boolean",
///                      "const": false
///                    }
///                  },
///                  "additionalProperties": false
///                }
///              ]
///            },
///            "type": {
///              "type": "string",
///              "const": "workspace.result"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "approved",
///            "id",
///            "type"
///          ],
///          "properties": {
///            "approved": {
///              "type": "boolean"
///            },
///            "id": {
///              "type": "string"
///            },
///            "type": {
///              "type": "string",
///              "const": "approval.answer"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "sessionId",
///            "type"
///          ],
///          "properties": {
///            "sessionId": {
///              "type": "string",
///              "maxLength": 128,
///              "minLength": 1
///            },
///            "type": {
///              "type": "string",
///              "const": "terminal.opened"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "data",
///            "sessionId",
///            "type"
///          ],
///          "properties": {
///            "data": {
///              "type": "string",
///              "maxLength": 128000
///            },
///            "sessionId": {
///              "type": "string",
///              "maxLength": 128,
///              "minLength": 1
///            },
///            "type": {
///              "type": "string",
///              "const": "terminal.output"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "exitCode",
///            "sessionId",
///            "type"
///          ],
///          "properties": {
///            "exitCode": {
///              "anyOf": [
///                {
///                  "type": "integer",
///                  "maximum": 9007199254740991.0,
///                  "minimum": -9007199254740991.0
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            },
///            "sessionId": {
///              "type": "string",
///              "maxLength": 128,
///              "minLength": 1
///            },
///            "type": {
///              "type": "string",
///              "const": "terminal.exit"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "message",
///            "sessionId",
///            "type"
///          ],
///          "properties": {
///            "message": {
///              "type": "string",
///              "maxLength": 2048
///            },
///            "sessionId": {
///              "type": "string",
///              "maxLength": 128,
///              "minLength": 1
///            },
///            "type": {
///              "type": "string",
///              "const": "terminal.error"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "hook",
///            "run",
///            "type"
///          ],
///          "properties": {
///            "hook": {
///              "type": "string",
///              "enum": [
///                "install",
///                "resume"
///              ]
///            },
///            "run": {
///              "type": "object",
///              "required": [
///                "exitCode",
///                "finishedAt",
///                "runId",
///                "scriptSha256",
///                "source",
///                "startedAt",
///                "status",
///                "trigger",
///                "truncated"
///              ],
///              "properties": {
///                "exitCode": {
///                  "anyOf": [
///                    {
///                      "type": "integer",
///                      "maximum": 9007199254740991.0,
///                      "minimum": -9007199254740991.0
///                    },
///                    {
///                      "type": "null"
///                    }
///                  ]
///                },
///                "finishedAt": {
///                  "anyOf": [
///                    {
///                      "type": "integer",
///                      "maximum": 9007199254740991.0,
///                      "minimum": -9007199254740991.0
///                    },
///                    {
///                      "type": "null"
///                    }
///                  ]
///                },
///                "output": {
///                  "type": "string",
///                  "maxLength": 16000
///                },
///                "runId": {
///                  "type": "string",
///                  "maxLength": 64,
///                  "minLength": 1
///                },
///                "scriptSha256": {
///                  "anyOf": [
///                    {
///                      "type": "string",
///                      "maxLength": 64,
///                      "minLength": 64
///                    },
///                    {
///                      "type": "null"
///                    }
///                  ]
///                },
///                "source": {
///                  "type": "string",
///                  "enum": [
///                    "dashboard",
///                    "repository",
///                    "none"
///                  ]
///                },
///                "startedAt": {
///                  "type": "integer",
///                  "maximum": 9007199254740991.0,
///                  "minimum": -9007199254740991.0
///                },
///                "status": {
///                  "type": "string",
///                  "enum": [
///                    "running",
///                    "ok",
///                    "failed",
///                    "timed_out",
///                    "skipped"
///                  ]
///                },
///                "trigger": {
///                  "type": "string",
///                  "enum": [
///                    "setup",
///                    "changed",
///                    "manual",
///                    "cold",
///                    "warm"
///                  ]
///                },
///                "truncated": {
///                  "default": false,
///                  "type": "boolean"
///                }
///              },
///              "additionalProperties": false
///            },
///            "type": {
///              "type": "string",
///              "const": "cloud.hook.state"
///            }
///          },
///          "additionalProperties": false
///        }
///      ],
///      "$schema": "https://json-schema.org/draft/2020-12/schema"
///    },
///    "localCommandPolicy": {
///      "type": "object",
///      "properties": {
///        "allow": {
///          "type": "array",
///          "items": {
///            "type": "string"
///          }
///        },
///        "approve": {
///          "type": "boolean"
///        },
///        "deny": {
///          "type": "array",
///          "items": {
///            "type": "string"
///          }
///        },
///        "mode": {
///          "type": "string",
///          "enum": [
///            "allow_all",
///            "allow_list",
///            "read_only"
///          ]
///        },
///        "shell": {
///          "type": "boolean"
///        },
///        "tools": {
///          "type": "array",
///          "items": {
///            "type": "string",
///            "enum": [
///              "read_file",
///              "list_files",
///              "grep",
///              "edit_file",
///              "write_file",
///              "apply_patch",
///              "list_git_workspaces",
///              "create_workspace",
///              "attach_workspace",
///              "detach_workspace",
///              "remove_workspace",
///              "run_command",
///              "start_command",
///              "get_command_output",
///              "send_command_input",
///              "kill_command",
///              "list_skills"
///            ]
///          }
///        }
///      },
///      "additionalProperties": false,
///      "$schema": "https://json-schema.org/draft/2020-12/schema"
///    },
///    "relayMessage": {
///      "oneOf": [
///        {
///          "type": "object",
///          "required": [
///            "heartbeatIntervalMs",
///            "serverTime",
///            "type"
///          ],
///          "properties": {
///            "cloudHooks": {
///              "type": "object",
///              "required": [
///                "repository",
///                "scripts"
///              ],
///              "properties": {
///                "repository": {
///                  "default": true,
///                  "type": "boolean"
///                },
///                "scripts": {
///                  "anyOf": [
///                    {
///                      "type": "object",
///                      "required": [
///                        "install",
///                        "resume"
///                      ],
///                      "properties": {
///                        "install": {
///                          "anyOf": [
///                            {
///                              "type": "string",
///                              "maxLength": 16384
///                            },
///                            {
///                              "type": "null"
///                            }
///                          ]
///                        },
///                        "resume": {
///                          "anyOf": [
///                            {
///                              "type": "string",
///                              "maxLength": 16384
///                            },
///                            {
///                              "type": "null"
///                            }
///                          ]
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "null"
///                    }
///                  ]
///                }
///              },
///              "additionalProperties": false
///            },
///            "heartbeatIntervalMs": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": -9007199254740991.0
///            },
///            "heartbeatMode": {
///              "type": "string",
///              "const": "auto"
///            },
///            "latestCliVersion": {
///              "type": "string"
///            },
///            "serverTime": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": -9007199254740991.0
///            },
///            "type": {
///              "type": "string",
///              "const": "hello.ack"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "type"
///          ],
///          "properties": {
///            "type": {
///              "type": "string",
///              "const": "heartbeat.ack"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "arguments",
///            "expiresAt",
///            "issuedAt",
///            "projectId",
///            "requestId",
///            "tool",
///            "type"
///          ],
///          "properties": {
///            "arguments": {},
///            "client": {
///              "type": "object",
///              "properties": {
///                "id": {
///                  "type": "string"
///                },
///                "name": {
///                  "type": "string"
///                },
///                "version": {
///                  "type": "string"
///                }
///              },
///              "additionalProperties": false
///            },
///            "expiresAt": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": -9007199254740991.0
///            },
///            "issuedAt": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": -9007199254740991.0
///            },
///            "policy": {
///              "type": "object",
///              "required": [
///                "allow",
///                "approve",
///                "deny",
///                "mode",
///                "shell",
///                "tools"
///              ],
///              "properties": {
///                "allow": {
///                  "default": [],
///                  "type": "array",
///                  "items": {
///                    "type": "string"
///                  }
///                },
///                "approve": {
///                  "default": false,
///                  "type": "boolean"
///                },
///                "deny": {
///                  "default": [],
///                  "type": "array",
///                  "items": {
///                    "type": "string"
///                  }
///                },
///                "mode": {
///                  "type": "string",
///                  "enum": [
///                    "allow_all",
///                    "allow_list",
///                    "read_only"
///                  ]
///                },
///                "shell": {
///                  "default": false,
///                  "type": "boolean"
///                },
///                "tools": {
///                  "default": null,
///                  "anyOf": [
///                    {
///                      "type": "array",
///                      "items": {
///                        "type": "string",
///                        "enum": [
///                          "read_file",
///                          "list_files",
///                          "grep",
///                          "edit_file",
///                          "write_file",
///                          "apply_patch",
///                          "list_git_workspaces",
///                          "create_workspace",
///                          "attach_workspace",
///                          "detach_workspace",
///                          "remove_workspace",
///                          "run_command",
///                          "start_command",
///                          "get_command_output",
///                          "send_command_input",
///                          "kill_command",
///                          "list_skills"
///                        ]
///                      }
///                    },
///                    {
///                      "type": "null"
///                    }
///                  ]
///                }
///              },
///              "additionalProperties": false
///            },
///            "projectId": {
///              "type": "string"
///            },
///            "requestId": {
///              "type": "string"
///            },
///            "tool": {
///              "type": "string",
///              "enum": [
///                "read_file",
///                "list_files",
///                "grep",
///                "edit_file",
///                "write_file",
///                "apply_patch",
///                "list_git_workspaces",
///                "create_workspace",
///                "attach_workspace",
///                "detach_workspace",
///                "remove_workspace",
///                "run_command",
///                "start_command",
///                "get_command_output",
///                "send_command_input",
///                "kill_command",
///                "list_skills"
///              ]
///            },
///            "type": {
///              "type": "string",
///              "const": "tool.call"
///            },
///            "workspaceId": {
///              "type": "string"
///            },
///            "workspaceSlug": {
///              "type": "string"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "arguments",
///            "expiresAt",
///            "issuedAt",
///            "policy",
///            "projectId",
///            "requestId",
///            "server",
///            "tool",
///            "type"
///          ],
///          "properties": {
///            "arguments": {},
///            "client": {
///              "type": "object",
///              "properties": {
///                "id": {
///                  "type": "string"
///                },
///                "name": {
///                  "type": "string"
///                },
///                "version": {
///                  "type": "string"
///                }
///              },
///              "additionalProperties": false
///            },
///            "expiresAt": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": -9007199254740991.0
///            },
///            "issuedAt": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": -9007199254740991.0
///            },
///            "policy": {
///              "type": "object",
///              "required": [
///                "allow",
///                "approve",
///                "deny",
///                "mode",
///                "shell",
///                "tools"
///              ],
///              "properties": {
///                "allow": {
///                  "default": [],
///                  "type": "array",
///                  "items": {
///                    "type": "string"
///                  }
///                },
///                "approve": {
///                  "default": false,
///                  "type": "boolean"
///                },
///                "deny": {
///                  "default": [],
///                  "type": "array",
///                  "items": {
///                    "type": "string"
///                  }
///                },
///                "mode": {
///                  "type": "string",
///                  "enum": [
///                    "allow_all",
///                    "allow_list",
///                    "read_only"
///                  ]
///                },
///                "shell": {
///                  "default": false,
///                  "type": "boolean"
///                },
///                "tools": {
///                  "default": null,
///                  "anyOf": [
///                    {
///                      "type": "array",
///                      "items": {
///                        "type": "string",
///                        "enum": [
///                          "read_file",
///                          "list_files",
///                          "grep",
///                          "edit_file",
///                          "write_file",
///                          "apply_patch",
///                          "list_git_workspaces",
///                          "create_workspace",
///                          "attach_workspace",
///                          "detach_workspace",
///                          "remove_workspace",
///                          "run_command",
///                          "start_command",
///                          "get_command_output",
///                          "send_command_input",
///                          "kill_command",
///                          "list_skills"
///                        ]
///                      }
///                    },
///                    {
///                      "type": "null"
///                    }
///                  ]
///                }
///              },
///              "additionalProperties": false
///            },
///            "projectId": {
///              "type": "string"
///            },
///            "requestId": {
///              "type": "string"
///            },
///            "server": {
///              "type": "string",
///              "maxLength": 64,
///              "minLength": 1
///            },
///            "tool": {
///              "type": "string",
///              "maxLength": 128,
///              "minLength": 1
///            },
///            "type": {
///              "type": "string",
///              "const": "mcp.call"
///            },
///            "workspaceId": {
///              "type": "string"
///            },
///            "workspaceSlug": {
///              "type": "string"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "action",
///            "expiresAt",
///            "issuedAt",
///            "projectId",
///            "requestId",
///            "type"
///          ],
///          "properties": {
///            "action": {
///              "oneOf": [
///                {
///                  "type": "object",
///                  "required": [
///                    "action"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "status"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "area",
///                    "path"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "diff"
///                    },
///                    "area": {
///                      "type": "string",
///                      "enum": [
///                        "working",
///                        "staged"
///                      ]
///                    },
///                    "path": {
///                      "type": "string",
///                      "maxLength": 4096,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "unpublished"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "paths"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "stage"
///                    },
///                    "paths": {
///                      "type": "array",
///                      "items": {
///                        "type": "string",
///                        "maxLength": 4096,
///                        "minLength": 1
///                      },
///                      "maxItems": 1000,
///                      "minItems": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "paths"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "unstage"
///                    },
///                    "paths": {
///                      "type": "array",
///                      "items": {
///                        "type": "string",
///                        "maxLength": 4096,
///                        "minLength": 1
///                      },
///                      "maxItems": 1000,
///                      "minItems": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "paths"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "discard"
///                    },
///                    "paths": {
///                      "type": "array",
///                      "items": {
///                        "type": "string",
///                        "maxLength": 4096,
///                        "minLength": 1
///                      },
///                      "maxItems": 1000,
///                      "minItems": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "paths"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "delete_untracked"
///                    },
///                    "paths": {
///                      "type": "array",
///                      "items": {
///                        "type": "string",
///                        "maxLength": 4096,
///                        "minLength": 1
///                      },
///                      "maxItems": 1000,
///                      "minItems": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "message"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "commit"
///                    },
///                    "message": {
///                      "type": "string",
///                      "maxLength": 10000,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "all"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "fetch"
///                    },
///                    "all": {
///                      "default": false,
///                      "type": "boolean"
///                    },
///                    "remote": {
///                      "type": "string",
///                      "maxLength": 512,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "pull"
///                    },
///                    "branch": {
///                      "type": "string",
///                      "maxLength": 512,
///                      "minLength": 1
///                    },
///                    "remote": {
///                      "type": "string",
///                      "maxLength": 512,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "setUpstream"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "push"
///                    },
///                    "remote": {
///                      "type": "string",
///                      "maxLength": 512,
///                      "minLength": 1
///                    },
///                    "setUpstream": {
///                      "default": false,
///                      "type": "boolean"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "name"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "branch_create"
///                    },
///                    "name": {
///                      "type": "string",
///                      "maxLength": 255,
///                      "minLength": 1
///                    },
///                    "startPoint": {
///                      "type": "string",
///                      "maxLength": 512,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "name"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "branch_switch"
///                    },
///                    "name": {
///                      "type": "string",
///                      "maxLength": 255,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "name",
///                    "remoteBranch"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "branch_track"
///                    },
///                    "name": {
///                      "type": "string",
///                      "maxLength": 255,
///                      "minLength": 1
///                    },
///                    "remoteBranch": {
///                      "type": "string",
///                      "maxLength": 512,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "name"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "branch_delete"
///                    },
///                    "name": {
///                      "type": "string",
///                      "maxLength": 255,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "branch",
///                    "reuseExistingBranch"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "workspace_create"
///                    },
///                    "branch": {
///                      "type": "string",
///                      "maxLength": 255,
///                      "minLength": 1
///                    },
///                    "from": {
///                      "type": "string",
///                      "maxLength": 512,
///                      "minLength": 1
///                    },
///                    "name": {
///                      "type": "string",
///                      "maxLength": 100,
///                      "minLength": 1
///                    },
///                    "reuseExistingBranch": {
///                      "default": false,
///                      "type": "boolean"
///                    },
///                    "slug": {
///                      "type": "string",
///                      "maxLength": 60,
///                      "minLength": 1,
///                      "pattern": "^[a-z0-9][a-z0-9-]*$"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "repository"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "project_prepare"
///                    },
///                    "repository": {
///                      "type": "object",
///                      "required": [
///                        "credential",
///                        "name",
///                        "slug",
///                        "url"
///                      ],
///                      "properties": {
///                        "credential": {
///                          "default": "machine",
///                          "type": "string",
///                          "enum": [
///                            "exeora",
///                            "machine"
///                          ]
///                        },
///                        "defaultBranch": {
///                          "type": "string",
///                          "maxLength": 255,
///                          "minLength": 1
///                        },
///                        "name": {
///                          "type": "string",
///                          "maxLength": 100,
///                          "minLength": 1
///                        },
///                        "slug": {
///                          "type": "string",
///                          "maxLength": 60,
///                          "minLength": 1,
///                          "pattern": "^[a-z0-9][a-z0-9-]*$"
///                        },
///                        "url": {
///                          "type": "string",
///                          "maxLength": 1000,
///                          "minLength": 1
///                        }
///                      },
///                      "additionalProperties": false
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "limit"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "log"
///                    },
///                    "cursor": {
///                      "type": "string",
///                      "maxLength": 64
///                    },
///                    "limit": {
///                      "default": 30,
///                      "type": "integer",
///                      "maximum": 100.0,
///                      "minimum": 1.0
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "oid"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "commit_detail"
///                    },
///                    "oid": {
///                      "type": "string",
///                      "pattern": "^[0-9a-f]{4,64}$"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "oid"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "commit_diff"
///                    },
///                    "oid": {
///                      "type": "string",
///                      "pattern": "^[0-9a-f]{4,64}$"
///                    },
///                    "path": {
///                      "type": "string",
///                      "maxLength": 4096,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "area"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "diff_all"
///                    },
///                    "area": {
///                      "type": "string",
///                      "enum": [
///                        "working",
///                        "staged"
///                      ]
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "base"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "range_diff"
///                    },
///                    "base": {
///                      "type": "string",
///                      "maxLength": 512,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "staged_context"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "base"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "range_context"
///                    },
///                    "base": {
///                      "type": "string",
///                      "maxLength": 512,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "stash_list"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "amend"
///                    },
///                    "message": {
///                      "type": "string",
///                      "maxLength": 10000,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "includeUntracked"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "stash_push"
///                    },
///                    "includeUntracked": {
///                      "default": true,
///                      "type": "boolean"
///                    },
///                    "message": {
///                      "type": "string",
///                      "maxLength": 1000,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "index"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "stash_pop"
///                    },
///                    "index": {
///                      "default": 0,
///                      "type": "integer",
///                      "maximum": 9007199254740991.0,
///                      "minimum": 0.0
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "index"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "stash_drop"
///                    },
///                    "index": {
///                      "type": "integer",
///                      "maximum": 9007199254740991.0,
///                      "minimum": 0.0
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "sync"
///                    },
///                    "remote": {
///                      "type": "string",
///                      "maxLength": 512,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "discard_all"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "path",
///                    "showIgnored"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "tree"
///                    },
///                    "path": {
///                      "default": ".",
///                      "type": "string",
///                      "maxLength": 4096,
///                      "minLength": 1
///                    },
///                    "showIgnored": {
///                      "default": false,
///                      "type": "boolean"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "encoding",
///                    "path"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "file_read"
///                    },
///                    "encoding": {
///                      "default": "text",
///                      "type": "string",
///                      "enum": [
///                        "text",
///                        "base64"
///                      ]
///                    },
///                    "path": {
///                      "type": "string",
///                      "maxLength": 4096,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "content",
///                    "create",
///                    "path"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "file_write"
///                    },
///                    "content": {
///                      "type": "string",
///                      "maxLength": 1000000
///                    },
///                    "create": {
///                      "default": true,
///                      "type": "boolean"
///                    },
///                    "expectedToken": {
///                      "type": "string",
///                      "maxLength": 64
///                    },
///                    "path": {
///                      "type": "string",
///                      "maxLength": 4096,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "path",
///                    "type"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "file_create"
///                    },
///                    "path": {
///                      "type": "string",
///                      "maxLength": 4096,
///                      "minLength": 1
///                    },
///                    "type": {
///                      "type": "string",
///                      "enum": [
///                        "file",
///                        "directory"
///                      ]
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "from",
///                    "overwrite",
///                    "to"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "file_rename"
///                    },
///                    "from": {
///                      "type": "string",
///                      "maxLength": 4096,
///                      "minLength": 1
///                    },
///                    "overwrite": {
///                      "default": false,
///                      "type": "boolean"
///                    },
///                    "to": {
///                      "type": "string",
///                      "maxLength": 4096,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "overwrite",
///                    "paths",
///                    "to"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "file_move"
///                    },
///                    "overwrite": {
///                      "default": false,
///                      "type": "boolean"
///                    },
///                    "paths": {
///                      "type": "array",
///                      "items": {
///                        "type": "string",
///                        "maxLength": 4096,
///                        "minLength": 1
///                      },
///                      "maxItems": 100,
///                      "minItems": 1
///                    },
///                    "to": {
///                      "type": "string",
///                      "maxLength": 4096,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "paths"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "file_delete"
///                    },
///                    "paths": {
///                      "type": "array",
///                      "items": {
///                        "type": "string",
///                        "maxLength": 4096,
///                        "minLength": 1
///                      },
///                      "maxItems": 100,
///                      "minItems": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "path"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "file_duplicate"
///                    },
///                    "path": {
///                      "type": "string",
///                      "maxLength": 4096,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "caseSensitive",
///                    "includeIgnored",
///                    "maxPerFile",
///                    "maxResults",
///                    "query",
///                    "regex",
///                    "wholeWord"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "search"
///                    },
///                    "caseSensitive": {
///                      "default": false,
///                      "type": "boolean"
///                    },
///                    "exclude": {
///                      "type": "string",
///                      "maxLength": 1000
///                    },
///                    "include": {
///                      "type": "string",
///                      "maxLength": 1000
///                    },
///                    "includeIgnored": {
///                      "default": false,
///                      "type": "boolean"
///                    },
///                    "maxPerFile": {
///                      "default": 50,
///                      "type": "integer",
///                      "maximum": 100.0,
///                      "minimum": 1.0
///                    },
///                    "maxResults": {
///                      "default": 500,
///                      "type": "integer",
///                      "maximum": 2000.0,
///                      "minimum": 1.0
///                    },
///                    "path": {
///                      "type": "string",
///                      "maxLength": 4096,
///                      "minLength": 1
///                    },
///                    "query": {
///                      "type": "string",
///                      "maxLength": 1000,
///                      "minLength": 1
///                    },
///                    "regex": {
///                      "default": false,
///                      "type": "boolean"
///                    },
///                    "wholeWord": {
///                      "default": false,
///                      "type": "boolean"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "caseSensitive",
///                    "preserveCase",
///                    "query",
///                    "regex",
///                    "replacement",
///                    "targets",
///                    "wholeWord"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "replace"
///                    },
///                    "caseSensitive": {
///                      "default": false,
///                      "type": "boolean"
///                    },
///                    "preserveCase": {
///                      "default": false,
///                      "type": "boolean"
///                    },
///                    "query": {
///                      "type": "string",
///                      "maxLength": 1000,
///                      "minLength": 1
///                    },
///                    "regex": {
///                      "default": false,
///                      "type": "boolean"
///                    },
///                    "replacement": {
///                      "type": "string",
///                      "maxLength": 10000
///                    },
///                    "targets": {
///                      "type": "array",
///                      "items": {
///                        "type": "object",
///                        "required": [
///                          "path",
///                          "token"
///                        ],
///                        "properties": {
///                          "lines": {
///                            "type": "array",
///                            "items": {
///                              "type": "integer",
///                              "maximum": 9007199254740991.0,
///                              "minimum": 1.0
///                            },
///                            "maxItems": 100
///                          },
///                          "path": {
///                            "type": "string",
///                            "maxLength": 4096,
///                            "minLength": 1
///                          },
///                          "token": {
///                            "type": "string",
///                            "maxLength": 64
///                          }
///                        },
///                        "additionalProperties": false
///                      },
///                      "maxItems": 500,
///                      "minItems": 1
///                    },
///                    "wholeWord": {
///                      "default": false,
///                      "type": "boolean"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "chatgpt_status"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "mode"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "chatgpt_login_start"
///                    },
///                    "mode": {
///                      "type": "string",
///                      "enum": [
///                        "new",
///                        "reauth",
///                        "enable_plan"
///                      ]
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "chatgpt_login_cancel"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "chatgpt_logout"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "chatgpt_models"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "object",
///                  "required": [
///                    "action",
///                    "input",
///                    "instructions"
///                  ],
///                  "properties": {
///                    "action": {
///                      "type": "string",
///                      "const": "chatgpt_generate"
///                    },
///                    "input": {
///                      "type": "string",
///                      "maxLength": 220000
///                    },
///                    "instructions": {
///                      "type": "string",
///                      "maxLength": 4000
///                    },
///                    "model": {
///                      "type": "string",
///                      "maxLength": 128,
///                      "minLength": 1,
///                      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$"
///                    }
///                  },
///                  "additionalProperties": false
///                }
///              ]
///            },
///            "expiresAt": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": -9007199254740991.0
///            },
///            "issuedAt": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": -9007199254740991.0
///            },
///            "projectId": {
///              "type": "string"
///            },
///            "requestId": {
///              "type": "string"
///            },
///            "type": {
///              "type": "string",
///              "const": "workspace.call"
///            },
///            "workspaceId": {
///              "type": "string"
///            },
///            "workspaceSlug": {
///              "type": "string"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "requestId",
///            "type"
///          ],
///          "properties": {
///            "requestId": {
///              "type": "string"
///            },
///            "type": {
///              "type": "string",
///              "const": "cancel"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "reason",
///            "type"
///          ],
///          "properties": {
///            "reason": {
///              "type": "string"
///            },
///            "type": {
///              "type": "string",
///              "const": "shutdown"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "expiresAt",
///            "id",
///            "projectId",
///            "prompt",
///            "tool",
///            "type"
///          ],
///          "properties": {
///            "client": {
///              "type": "object",
///              "properties": {
///                "name": {
///                  "type": "string"
///                },
///                "version": {
///                  "type": "string"
///                }
///              },
///              "additionalProperties": false
///            },
///            "expiresAt": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": -9007199254740991.0
///            },
///            "id": {
///              "type": "string"
///            },
///            "projectId": {
///              "type": "string"
///            },
///            "prompt": {
///              "type": "string"
///            },
///            "tool": {
///              "type": "string",
///              "maxLength": 128
///            },
///            "type": {
///              "type": "string",
///              "const": "approval.request"
///            },
///            "workspaceId": {
///              "type": "string"
///            },
///            "workspaceSlug": {
///              "type": "string"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "id",
///            "type"
///          ],
///          "properties": {
///            "id": {
///              "type": "string"
///            },
///            "type": {
///              "type": "string",
///              "const": "approval.resolved"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "cols",
///            "projectId",
///            "rows",
///            "sessionId",
///            "type"
///          ],
///          "properties": {
///            "cols": {
///              "type": "integer",
///              "maximum": 500.0,
///              "minimum": 20.0
///            },
///            "projectId": {
///              "type": "string"
///            },
///            "rows": {
///              "type": "integer",
///              "maximum": 300.0,
///              "minimum": 5.0
///            },
///            "sessionId": {
///              "type": "string",
///              "maxLength": 128,
///              "minLength": 1
///            },
///            "type": {
///              "type": "string",
///              "const": "terminal.open"
///            },
///            "workspaceId": {
///              "type": "string"
///            },
///            "workspaceSlug": {
///              "type": "string"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "data",
///            "sessionId",
///            "type"
///          ],
///          "properties": {
///            "data": {
///              "type": "string",
///              "maxLength": 128000
///            },
///            "sessionId": {
///              "type": "string",
///              "maxLength": 128,
///              "minLength": 1
///            },
///            "type": {
///              "type": "string",
///              "const": "terminal.input"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "cols",
///            "rows",
///            "sessionId",
///            "type"
///          ],
///          "properties": {
///            "cols": {
///              "type": "integer",
///              "maximum": 500.0,
///              "minimum": 20.0
///            },
///            "rows": {
///              "type": "integer",
///              "maximum": 300.0,
///              "minimum": 5.0
///            },
///            "sessionId": {
///              "type": "string",
///              "maxLength": 128,
///              "minLength": 1
///            },
///            "type": {
///              "type": "string",
///              "const": "terminal.resize"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "sessionId",
///            "type"
///          ],
///          "properties": {
///            "sessionId": {
///              "type": "string",
///              "maxLength": 128,
///              "minLength": 1
///            },
///            "type": {
///              "type": "string",
///              "const": "terminal.close"
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "config",
///            "hook",
///            "type"
///          ],
///          "properties": {
///            "config": {
///              "type": "object",
///              "required": [
///                "repository",
///                "scripts"
///              ],
///              "properties": {
///                "repository": {
///                  "default": true,
///                  "type": "boolean"
///                },
///                "scripts": {
///                  "anyOf": [
///                    {
///                      "type": "object",
///                      "required": [
///                        "install",
///                        "resume"
///                      ],
///                      "properties": {
///                        "install": {
///                          "anyOf": [
///                            {
///                              "type": "string",
///                              "maxLength": 16384
///                            },
///                            {
///                              "type": "null"
///                            }
///                          ]
///                        },
///                        "resume": {
///                          "anyOf": [
///                            {
///                              "type": "string",
///                              "maxLength": 16384
///                            },
///                            {
///                              "type": "null"
///                            }
///                          ]
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "null"
///                    }
///                  ]
///                }
///              },
///              "additionalProperties": false
///            },
///            "hook": {
///              "type": "string",
///              "enum": [
///                "install",
///                "resume"
///              ]
///            },
///            "type": {
///              "type": "string",
///              "const": "cloud.hook.run"
///            }
///          },
///          "additionalProperties": false
///        }
///      ],
///      "$schema": "https://json-schema.org/draft/2020-12/schema"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypes {
    #[serde(rename = "cloudCliConfig")]
    pub cloud_cli_config: ExeoraProtocolTypesCloudCliConfig,
    #[serde(rename = "commandPolicy")]
    pub command_policy: ExeoraProtocolTypesCommandPolicy,
    #[serde(rename = "executorMessage")]
    pub executor_message: ExeoraProtocolTypesExecutorMessage,
    #[serde(rename = "localCommandPolicy")]
    pub local_command_policy: ExeoraProtocolTypesLocalCommandPolicy,
    #[serde(rename = "relayMessage")]
    pub relay_message: ExeoraProtocolTypesRelayMessage,
}
///`ExeoraProtocolTypesCloudCliConfig`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "deviceId",
///    "deviceName",
///    "gatewayUrl",
///    "projects",
///    "workspaceRoot",
///    "workspaces"
///  ],
///  "properties": {
///    "deviceId": {
///      "type": "string",
///      "minLength": 1
///    },
///    "deviceName": {
///      "type": "string",
///      "minLength": 1
///    },
///    "gatewayUrl": {
///      "type": "string",
///      "format": "uri"
///    },
///    "projects": {
///      "type": "array",
///      "items": {
///        "type": "object",
///        "required": [
///          "id",
///          "name",
///          "root",
///          "slug"
///        ],
///        "properties": {
///          "id": {
///            "type": "string",
///            "minLength": 1
///          },
///          "name": {
///            "type": "string",
///            "minLength": 1
///          },
///          "root": {
///            "type": "string",
///            "minLength": 1
///          },
///          "slug": {
///            "type": "string",
///            "minLength": 1
///          }
///        },
///        "additionalProperties": false
///      }
///    },
///    "workspaceRoot": {
///      "type": "string",
///      "minLength": 1
///    },
///    "workspaces": {
///      "type": "array",
///      "items": {
///        "type": "object",
///        "required": [
///          "branch",
///          "gitRoot",
///          "id",
///          "managed",
///          "name",
///          "projectId",
///          "root",
///          "slug",
///          "syncState"
///        ],
///        "properties": {
///          "branch": {
///            "anyOf": [
///              {
///                "type": "string"
///              },
///              {
///                "type": "null"
///              }
///            ]
///          },
///          "gitRoot": {
///            "type": "string",
///            "minLength": 1
///          },
///          "id": {
///            "type": "string",
///            "minLength": 1
///          },
///          "managed": {
///            "type": "boolean"
///          },
///          "name": {
///            "type": "string",
///            "minLength": 1
///          },
///          "projectId": {
///            "type": "string",
///            "minLength": 1
///          },
///          "root": {
///            "type": "string",
///            "minLength": 1
///          },
///          "slug": {
///            "type": "string",
///            "minLength": 1
///          },
///          "syncState": {
///            "type": "string",
///            "enum": [
///              "pendingUpsert",
///              "active",
///              "pendingDelete",
///              "disabled",
///              "removing"
///            ]
///          }
///        },
///        "additionalProperties": false
///      }
///    }
///  },
///  "additionalProperties": false,
///  "$schema": "https://json-schema.org/draft/2020-12/schema"
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesCloudCliConfig {
    #[serde(rename = "deviceId")]
    pub device_id: ExeoraProtocolTypesCloudCliConfigDeviceId,
    #[serde(rename = "deviceName")]
    pub device_name: ExeoraProtocolTypesCloudCliConfigDeviceName,
    #[serde(rename = "gatewayUrl")]
    pub gateway_url: ::std::string::String,
    pub projects: ::std::vec::Vec<ExeoraProtocolTypesCloudCliConfigProjectsItem>,
    #[serde(rename = "workspaceRoot")]
    pub workspace_root: ExeoraProtocolTypesCloudCliConfigWorkspaceRoot,
    pub workspaces: ::std::vec::Vec<ExeoraProtocolTypesCloudCliConfigWorkspacesItem>,
}
///`ExeoraProtocolTypesCloudCliConfigDeviceId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesCloudCliConfigDeviceId(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesCloudCliConfigDeviceId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesCloudCliConfigDeviceId> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesCloudCliConfigDeviceId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesCloudCliConfigDeviceId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesCloudCliConfigDeviceId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesCloudCliConfigDeviceId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesCloudCliConfigDeviceId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesCloudCliConfigDeviceId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesCloudCliConfigDeviceName`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesCloudCliConfigDeviceName(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesCloudCliConfigDeviceName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesCloudCliConfigDeviceName> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesCloudCliConfigDeviceName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesCloudCliConfigDeviceName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesCloudCliConfigDeviceName {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigDeviceName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigDeviceName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesCloudCliConfigDeviceName {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesCloudCliConfigProjectsItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "id",
///    "name",
///    "root",
///    "slug"
///  ],
///  "properties": {
///    "id": {
///      "type": "string",
///      "minLength": 1
///    },
///    "name": {
///      "type": "string",
///      "minLength": 1
///    },
///    "root": {
///      "type": "string",
///      "minLength": 1
///    },
///    "slug": {
///      "type": "string",
///      "minLength": 1
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesCloudCliConfigProjectsItem {
    pub id: ExeoraProtocolTypesCloudCliConfigProjectsItemId,
    pub name: ExeoraProtocolTypesCloudCliConfigProjectsItemName,
    pub root: ExeoraProtocolTypesCloudCliConfigProjectsItemRoot,
    pub slug: ExeoraProtocolTypesCloudCliConfigProjectsItemSlug,
}
///`ExeoraProtocolTypesCloudCliConfigProjectsItemId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesCloudCliConfigProjectsItemId(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesCloudCliConfigProjectsItemId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesCloudCliConfigProjectsItemId>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesCloudCliConfigProjectsItemId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesCloudCliConfigProjectsItemId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesCloudCliConfigProjectsItemId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigProjectsItemId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigProjectsItemId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesCloudCliConfigProjectsItemId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesCloudCliConfigProjectsItemName`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesCloudCliConfigProjectsItemName(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesCloudCliConfigProjectsItemName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesCloudCliConfigProjectsItemName>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesCloudCliConfigProjectsItemName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesCloudCliConfigProjectsItemName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesCloudCliConfigProjectsItemName {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigProjectsItemName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigProjectsItemName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesCloudCliConfigProjectsItemName {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesCloudCliConfigProjectsItemRoot`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesCloudCliConfigProjectsItemRoot(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesCloudCliConfigProjectsItemRoot {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesCloudCliConfigProjectsItemRoot>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesCloudCliConfigProjectsItemRoot) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesCloudCliConfigProjectsItemRoot {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesCloudCliConfigProjectsItemRoot {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigProjectsItemRoot
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigProjectsItemRoot
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesCloudCliConfigProjectsItemRoot {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesCloudCliConfigProjectsItemSlug`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesCloudCliConfigProjectsItemSlug(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesCloudCliConfigProjectsItemSlug {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesCloudCliConfigProjectsItemSlug>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesCloudCliConfigProjectsItemSlug) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesCloudCliConfigProjectsItemSlug {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesCloudCliConfigProjectsItemSlug {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigProjectsItemSlug
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigProjectsItemSlug
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesCloudCliConfigProjectsItemSlug {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesCloudCliConfigWorkspaceRoot`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesCloudCliConfigWorkspaceRoot(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesCloudCliConfigWorkspaceRoot {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesCloudCliConfigWorkspaceRoot>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesCloudCliConfigWorkspaceRoot) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesCloudCliConfigWorkspaceRoot {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesCloudCliConfigWorkspaceRoot {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigWorkspaceRoot
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigWorkspaceRoot
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesCloudCliConfigWorkspaceRoot {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesCloudCliConfigWorkspacesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "branch",
///    "gitRoot",
///    "id",
///    "managed",
///    "name",
///    "projectId",
///    "root",
///    "slug",
///    "syncState"
///  ],
///  "properties": {
///    "branch": {
///      "anyOf": [
///        {
///          "type": "string"
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "gitRoot": {
///      "type": "string",
///      "minLength": 1
///    },
///    "id": {
///      "type": "string",
///      "minLength": 1
///    },
///    "managed": {
///      "type": "boolean"
///    },
///    "name": {
///      "type": "string",
///      "minLength": 1
///    },
///    "projectId": {
///      "type": "string",
///      "minLength": 1
///    },
///    "root": {
///      "type": "string",
///      "minLength": 1
///    },
///    "slug": {
///      "type": "string",
///      "minLength": 1
///    },
///    "syncState": {
///      "type": "string",
///      "enum": [
///        "pendingUpsert",
///        "active",
///        "pendingDelete",
///        "disabled",
///        "removing"
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesCloudCliConfigWorkspacesItem {
    pub branch: ::std::option::Option<::std::string::String>,
    #[serde(rename = "gitRoot")]
    pub git_root: ExeoraProtocolTypesCloudCliConfigWorkspacesItemGitRoot,
    pub id: ExeoraProtocolTypesCloudCliConfigWorkspacesItemId,
    pub managed: bool,
    pub name: ExeoraProtocolTypesCloudCliConfigWorkspacesItemName,
    #[serde(rename = "projectId")]
    pub project_id: ExeoraProtocolTypesCloudCliConfigWorkspacesItemProjectId,
    pub root: ExeoraProtocolTypesCloudCliConfigWorkspacesItemRoot,
    pub slug: ExeoraProtocolTypesCloudCliConfigWorkspacesItemSlug,
    #[serde(rename = "syncState")]
    pub sync_state: ExeoraProtocolTypesCloudCliConfigWorkspacesItemSyncState,
}
///`ExeoraProtocolTypesCloudCliConfigWorkspacesItemGitRoot`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesCloudCliConfigWorkspacesItemGitRoot(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesCloudCliConfigWorkspacesItemGitRoot {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesCloudCliConfigWorkspacesItemGitRoot>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesCloudCliConfigWorkspacesItemGitRoot) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesCloudCliConfigWorkspacesItemGitRoot {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesCloudCliConfigWorkspacesItemGitRoot {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigWorkspacesItemGitRoot
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigWorkspacesItemGitRoot
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesCloudCliConfigWorkspacesItemGitRoot {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesCloudCliConfigWorkspacesItemId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesCloudCliConfigWorkspacesItemId(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesCloudCliConfigWorkspacesItemId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesCloudCliConfigWorkspacesItemId>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesCloudCliConfigWorkspacesItemId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesCloudCliConfigWorkspacesItemId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesCloudCliConfigWorkspacesItemId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigWorkspacesItemId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigWorkspacesItemId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesCloudCliConfigWorkspacesItemId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesCloudCliConfigWorkspacesItemName`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesCloudCliConfigWorkspacesItemName(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesCloudCliConfigWorkspacesItemName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesCloudCliConfigWorkspacesItemName>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesCloudCliConfigWorkspacesItemName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesCloudCliConfigWorkspacesItemName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesCloudCliConfigWorkspacesItemName {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigWorkspacesItemName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigWorkspacesItemName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesCloudCliConfigWorkspacesItemName {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesCloudCliConfigWorkspacesItemProjectId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesCloudCliConfigWorkspacesItemProjectId(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesCloudCliConfigWorkspacesItemProjectId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesCloudCliConfigWorkspacesItemProjectId>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesCloudCliConfigWorkspacesItemProjectId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesCloudCliConfigWorkspacesItemProjectId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesCloudCliConfigWorkspacesItemProjectId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigWorkspacesItemProjectId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigWorkspacesItemProjectId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesCloudCliConfigWorkspacesItemProjectId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesCloudCliConfigWorkspacesItemRoot`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesCloudCliConfigWorkspacesItemRoot(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesCloudCliConfigWorkspacesItemRoot {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesCloudCliConfigWorkspacesItemRoot>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesCloudCliConfigWorkspacesItemRoot) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesCloudCliConfigWorkspacesItemRoot {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesCloudCliConfigWorkspacesItemRoot {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigWorkspacesItemRoot
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigWorkspacesItemRoot
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesCloudCliConfigWorkspacesItemRoot {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesCloudCliConfigWorkspacesItemSlug`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesCloudCliConfigWorkspacesItemSlug(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesCloudCliConfigWorkspacesItemSlug {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesCloudCliConfigWorkspacesItemSlug>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesCloudCliConfigWorkspacesItemSlug) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesCloudCliConfigWorkspacesItemSlug {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesCloudCliConfigWorkspacesItemSlug {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigWorkspacesItemSlug
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigWorkspacesItemSlug
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesCloudCliConfigWorkspacesItemSlug {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesCloudCliConfigWorkspacesItemSyncState`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "pendingUpsert",
///    "active",
///    "pendingDelete",
///    "disabled",
///    "removing"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesCloudCliConfigWorkspacesItemSyncState {
    #[serde(rename = "pendingUpsert")]
    PendingUpsert,
    #[serde(rename = "active")]
    Active,
    #[serde(rename = "pendingDelete")]
    PendingDelete,
    #[serde(rename = "disabled")]
    Disabled,
    #[serde(rename = "removing")]
    Removing,
}
impl ::std::fmt::Display for ExeoraProtocolTypesCloudCliConfigWorkspacesItemSyncState {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::PendingUpsert => f.write_str("pendingUpsert"),
            Self::Active => f.write_str("active"),
            Self::PendingDelete => f.write_str("pendingDelete"),
            Self::Disabled => f.write_str("disabled"),
            Self::Removing => f.write_str("removing"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesCloudCliConfigWorkspacesItemSyncState {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "pendingUpsert" => Ok(Self::PendingUpsert),
            "active" => Ok(Self::Active),
            "pendingDelete" => Ok(Self::PendingDelete),
            "disabled" => Ok(Self::Disabled),
            "removing" => Ok(Self::Removing),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesCloudCliConfigWorkspacesItemSyncState {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigWorkspacesItemSyncState
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesCloudCliConfigWorkspacesItemSyncState
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesCommandPolicy`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "allow",
///    "approve",
///    "deny",
///    "mode",
///    "shell",
///    "tools"
///  ],
///  "properties": {
///    "allow": {
///      "default": [],
///      "type": "array",
///      "items": {
///        "type": "string"
///      }
///    },
///    "approve": {
///      "default": false,
///      "type": "boolean"
///    },
///    "deny": {
///      "default": [],
///      "type": "array",
///      "items": {
///        "type": "string"
///      }
///    },
///    "mode": {
///      "type": "string",
///      "enum": [
///        "allow_all",
///        "allow_list",
///        "read_only"
///      ]
///    },
///    "shell": {
///      "default": false,
///      "type": "boolean"
///    },
///    "tools": {
///      "default": null,
///      "anyOf": [
///        {
///          "type": "array",
///          "items": {
///            "type": "string",
///            "enum": [
///              "read_file",
///              "list_files",
///              "grep",
///              "edit_file",
///              "write_file",
///              "apply_patch",
///              "list_git_workspaces",
///              "create_workspace",
///              "attach_workspace",
///              "detach_workspace",
///              "remove_workspace",
///              "run_command",
///              "start_command",
///              "get_command_output",
///              "send_command_input",
///              "kill_command",
///              "list_skills"
///            ]
///          }
///        },
///        {
///          "type": "null"
///        }
///      ]
///    }
///  },
///  "additionalProperties": false,
///  "$schema": "https://json-schema.org/draft/2020-12/schema"
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesCommandPolicy {
    pub allow: ::std::vec::Vec<::std::string::String>,
    pub approve: bool,
    pub deny: ::std::vec::Vec<::std::string::String>,
    pub mode: ExeoraProtocolTypesCommandPolicyMode,
    pub shell: bool,
    pub tools: ::std::option::Option<::std::vec::Vec<ExeoraProtocolTypesCommandPolicyToolsItem>>,
}
///`ExeoraProtocolTypesCommandPolicyMode`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "allow_all",
///    "allow_list",
///    "read_only"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesCommandPolicyMode {
    #[serde(rename = "allow_all")]
    AllowAll,
    #[serde(rename = "allow_list")]
    AllowList,
    #[serde(rename = "read_only")]
    ReadOnly,
}
impl ::std::fmt::Display for ExeoraProtocolTypesCommandPolicyMode {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::AllowAll => f.write_str("allow_all"),
            Self::AllowList => f.write_str("allow_list"),
            Self::ReadOnly => f.write_str("read_only"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesCommandPolicyMode {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "allow_all" => Ok(Self::AllowAll),
            "allow_list" => Ok(Self::AllowList),
            "read_only" => Ok(Self::ReadOnly),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesCommandPolicyMode {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesCommandPolicyMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesCommandPolicyMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesCommandPolicyToolsItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "read_file",
///    "list_files",
///    "grep",
///    "edit_file",
///    "write_file",
///    "apply_patch",
///    "list_git_workspaces",
///    "create_workspace",
///    "attach_workspace",
///    "detach_workspace",
///    "remove_workspace",
///    "run_command",
///    "start_command",
///    "get_command_output",
///    "send_command_input",
///    "kill_command",
///    "list_skills"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesCommandPolicyToolsItem {
    #[serde(rename = "read_file")]
    ReadFile,
    #[serde(rename = "list_files")]
    ListFiles,
    #[serde(rename = "grep")]
    Grep,
    #[serde(rename = "edit_file")]
    EditFile,
    #[serde(rename = "write_file")]
    WriteFile,
    #[serde(rename = "apply_patch")]
    ApplyPatch,
    #[serde(rename = "list_git_workspaces")]
    ListGitWorkspaces,
    #[serde(rename = "create_workspace")]
    CreateWorkspace,
    #[serde(rename = "attach_workspace")]
    AttachWorkspace,
    #[serde(rename = "detach_workspace")]
    DetachWorkspace,
    #[serde(rename = "remove_workspace")]
    RemoveWorkspace,
    #[serde(rename = "run_command")]
    RunCommand,
    #[serde(rename = "start_command")]
    StartCommand,
    #[serde(rename = "get_command_output")]
    GetCommandOutput,
    #[serde(rename = "send_command_input")]
    SendCommandInput,
    #[serde(rename = "kill_command")]
    KillCommand,
    #[serde(rename = "list_skills")]
    ListSkills,
}
impl ::std::fmt::Display for ExeoraProtocolTypesCommandPolicyToolsItem {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::ReadFile => f.write_str("read_file"),
            Self::ListFiles => f.write_str("list_files"),
            Self::Grep => f.write_str("grep"),
            Self::EditFile => f.write_str("edit_file"),
            Self::WriteFile => f.write_str("write_file"),
            Self::ApplyPatch => f.write_str("apply_patch"),
            Self::ListGitWorkspaces => f.write_str("list_git_workspaces"),
            Self::CreateWorkspace => f.write_str("create_workspace"),
            Self::AttachWorkspace => f.write_str("attach_workspace"),
            Self::DetachWorkspace => f.write_str("detach_workspace"),
            Self::RemoveWorkspace => f.write_str("remove_workspace"),
            Self::RunCommand => f.write_str("run_command"),
            Self::StartCommand => f.write_str("start_command"),
            Self::GetCommandOutput => f.write_str("get_command_output"),
            Self::SendCommandInput => f.write_str("send_command_input"),
            Self::KillCommand => f.write_str("kill_command"),
            Self::ListSkills => f.write_str("list_skills"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesCommandPolicyToolsItem {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "read_file" => Ok(Self::ReadFile),
            "list_files" => Ok(Self::ListFiles),
            "grep" => Ok(Self::Grep),
            "edit_file" => Ok(Self::EditFile),
            "write_file" => Ok(Self::WriteFile),
            "apply_patch" => Ok(Self::ApplyPatch),
            "list_git_workspaces" => Ok(Self::ListGitWorkspaces),
            "create_workspace" => Ok(Self::CreateWorkspace),
            "attach_workspace" => Ok(Self::AttachWorkspace),
            "detach_workspace" => Ok(Self::DetachWorkspace),
            "remove_workspace" => Ok(Self::RemoveWorkspace),
            "run_command" => Ok(Self::RunCommand),
            "start_command" => Ok(Self::StartCommand),
            "get_command_output" => Ok(Self::GetCommandOutput),
            "send_command_input" => Ok(Self::SendCommandInput),
            "kill_command" => Ok(Self::KillCommand),
            "list_skills" => Ok(Self::ListSkills),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesCommandPolicyToolsItem {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesCommandPolicyToolsItem {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesCommandPolicyToolsItem {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessage`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "object",
///      "required": [
///        "cliVersion",
///        "deviceId",
///        "platform",
///        "projects",
///        "protocolVersion",
///        "type"
///      ],
///      "properties": {
///        "capabilities": {
///          "type": "object",
///          "required": [
///            "prompt",
///            "tools"
///          ],
///          "properties": {
///            "features": {
///              "type": "array",
///              "items": {
///                "type": "string",
///                "maxLength": 64
///              },
///              "maxItems": 32
///            },
///            "prompt": {
///              "type": "boolean"
///            },
///            "tools": {
///              "type": "array",
///              "items": {
///                "type": "string",
///                "maxLength": 64
///              },
///              "maxItems": 64
///            },
///            "workspaceRouting": {
///              "type": "boolean"
///            }
///          },
///          "additionalProperties": false
///        },
///        "cliVersion": {
///          "type": "string"
///        },
///        "deviceId": {
///          "type": "string"
///        },
///        "platform": {
///          "type": "string"
///        },
///        "projects": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "id",
///              "slug"
///            ],
///            "properties": {
///              "id": {
///                "type": "string"
///              },
///              "slug": {
///                "type": "string"
///              }
///            },
///            "additionalProperties": false
///          }
///        },
///        "protocolVersion": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": -9007199254740991.0
///        },
///        "type": {
///          "type": "string",
///          "const": "hello"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "type"
///      ],
///      "properties": {
///        "at": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": -9007199254740991.0
///        },
///        "type": {
///          "type": "string",
///          "const": "heartbeat"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "at",
///        "type"
///      ],
///      "properties": {
///        "at": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": -9007199254740991.0
///        },
///        "type": {
///          "type": "string",
///          "const": "presence"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "projectId",
///        "tools",
///        "type"
///      ],
///      "properties": {
///        "projectId": {
///          "type": "string"
///        },
///        "tools": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "exposedName",
///              "inputSchema",
///              "name",
///              "server"
///            ],
///            "properties": {
///              "annotations": {
///                "type": "object",
///                "properties": {
///                  "destructiveHint": {
///                    "type": "boolean"
///                  },
///                  "idempotentHint": {
///                    "type": "boolean"
///                  },
///                  "openWorldHint": {
///                    "type": "boolean"
///                  },
///                  "readOnlyHint": {
///                    "type": "boolean"
///                  }
///                },
///                "additionalProperties": false
///              },
///              "description": {
///                "type": "string",
///                "maxLength": 4096
///              },
///              "exposedName": {
///                "type": "string",
///                "maxLength": 64,
///                "minLength": 1,
///                "pattern": "^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+(?:__[a-f0-9]{10})?$"
///              },
///              "inputSchema": {
///                "type": "object",
///                "additionalProperties": {},
///                "propertyNames": {
///                  "type": "string"
///                }
///              },
///              "name": {
///                "type": "string",
///                "maxLength": 128,
///                "minLength": 1
///              },
///              "server": {
///                "type": "string",
///                "maxLength": 64,
///                "minLength": 1
///              },
///              "title": {
///                "type": "string",
///                "maxLength": 512
///              }
///            },
///            "additionalProperties": false
///          },
///          "maxItems": 256
///        },
///        "type": {
///          "type": "string",
///          "const": "mcp.catalog"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "durationMs",
///        "requestId",
///        "result",
///        "type"
///      ],
///      "properties": {
///        "durationMs": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": -9007199254740991.0
///        },
///        "requestId": {
///          "type": "string"
///        },
///        "result": {
///          "oneOf": [
///            {
///              "type": "object",
///              "required": [
///                "ok",
///                "value"
///              ],
///              "properties": {
///                "ok": {
///                  "type": "boolean",
///                  "const": true
///                },
///                "value": {}
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "error",
///                "ok"
///              ],
///              "properties": {
///                "error": {
///                  "type": "object",
///                  "required": [
///                    "code",
///                    "message"
///                  ],
///                  "properties": {
///                    "code": {
///                      "type": "string",
///                      "enum": [
///                        "LOCAL_EXECUTOR_OFFLINE",
///                        "EXECUTOR_WAKING",
///                        "TOOL_TIMEOUT",
///                        "CANCELLED",
///                        "PATH_ESCAPE",
///                        "PATH_NOT_FOUND",
///                        "TOOL_FAILED",
///                        "INVALID_ARGUMENTS",
///                        "UNKNOWN_TOOL",
///                        "UNKNOWN_PROJECT",
///                        "UNKNOWN_WORKSPACE",
///                        "WORKSPACE_UNAVAILABLE",
///                        "UNKNOWN_PROCESS",
///                        "NO_ACTIVE_PROJECT",
///                        "FORBIDDEN",
///                        "APPROVAL_DECLINED",
///                        "APPROVAL_TIMEOUT",
///                        "INTERNAL_ERROR"
///                      ]
///                    },
///                    "message": {
///                      "type": "string"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                "ok": {
///                  "type": "boolean",
///                  "const": false
///                }
///              },
///              "additionalProperties": false
///            }
///          ]
///        },
///        "type": {
///          "type": "string",
///          "const": "tool.result"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "durationMs",
///        "requestId",
///        "result",
///        "type"
///      ],
///      "properties": {
///        "durationMs": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": -9007199254740991.0
///        },
///        "requestId": {
///          "type": "string"
///        },
///        "result": {
///          "oneOf": [
///            {
///              "type": "object",
///              "required": [
///                "ok",
///                "value"
///              ],
///              "properties": {
///                "ok": {
///                  "type": "boolean",
///                  "const": true
///                },
///                "value": {}
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "error",
///                "ok"
///              ],
///              "properties": {
///                "error": {
///                  "type": "object",
///                  "required": [
///                    "code",
///                    "message"
///                  ],
///                  "properties": {
///                    "code": {
///                      "type": "string",
///                      "enum": [
///                        "LOCAL_EXECUTOR_OFFLINE",
///                        "EXECUTOR_WAKING",
///                        "TOOL_TIMEOUT",
///                        "CANCELLED",
///                        "PATH_ESCAPE",
///                        "PATH_NOT_FOUND",
///                        "TOOL_FAILED",
///                        "INVALID_ARGUMENTS",
///                        "UNKNOWN_TOOL",
///                        "UNKNOWN_PROJECT",
///                        "UNKNOWN_WORKSPACE",
///                        "WORKSPACE_UNAVAILABLE",
///                        "UNKNOWN_PROCESS",
///                        "NO_ACTIVE_PROJECT",
///                        "FORBIDDEN",
///                        "APPROVAL_DECLINED",
///                        "APPROVAL_TIMEOUT",
///                        "INTERNAL_ERROR"
///                      ]
///                    },
///                    "message": {
///                      "type": "string"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                "ok": {
///                  "type": "boolean",
///                  "const": false
///                }
///              },
///              "additionalProperties": false
///            }
///          ]
///        },
///        "type": {
///          "type": "string",
///          "const": "mcp.result"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "durationMs",
///        "requestId",
///        "result",
///        "type"
///      ],
///      "properties": {
///        "durationMs": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": -9007199254740991.0
///        },
///        "requestId": {
///          "type": "string"
///        },
///        "result": {
///          "oneOf": [
///            {
///              "type": "object",
///              "required": [
///                "ok",
///                "value"
///              ],
///              "properties": {
///                "ok": {
///                  "type": "boolean",
///                  "const": true
///                },
///                "value": {
///                  "oneOf": [
///                    {
///                      "type": "object",
///                      "required": [
///                        "ahead",
///                        "behind",
///                        "branches",
///                        "files",
///                        "gitWorkspaces",
///                        "head",
///                        "kind",
///                        "oid",
///                        "operation",
///                        "remotes",
///                        "repository",
///                        "stashes",
///                        "upstream"
///                      ],
///                      "properties": {
///                        "ahead": {
///                          "type": "integer",
///                          "maximum": 9007199254740991.0,
///                          "minimum": 0.0
///                        },
///                        "behind": {
///                          "type": "integer",
///                          "maximum": 9007199254740991.0,
///                          "minimum": 0.0
///                        },
///                        "branches": {
///                          "type": "array",
///                          "items": {
///                            "type": "object",
///                            "required": [
///                              "ahead",
///                              "current",
///                              "name",
///                              "remote",
///                              "shortOid",
///                              "upstream"
///                            ],
///                            "properties": {
///                              "ahead": {
///                                "default": null,
///                                "anyOf": [
///                                  {
///                                    "type": "integer",
///                                    "maximum": 9007199254740991.0,
///                                    "minimum": 0.0
///                                  },
///                                  {
///                                    "type": "null"
///                                  }
///                                ]
///                              },
///                              "current": {
///                                "type": "boolean"
///                              },
///                              "name": {
///                                "type": "string"
///                              },
///                              "remote": {
///                                "type": "boolean"
///                              },
///                              "shortOid": {
///                                "type": "string"
///                              },
///                              "upstream": {
///                                "anyOf": [
///                                  {
///                                    "type": "string"
///                                  },
///                                  {
///                                    "type": "null"
///                                  }
///                                ]
///                              }
///                            },
///                            "additionalProperties": false
///                          }
///                        },
///                        "files": {
///                          "type": "array",
///                          "items": {
///                            "type": "object",
///                            "required": [
///                              "index",
///                              "kind",
///                              "path",
///                              "submodule",
///                              "worktree"
///                            ],
///                            "properties": {
///                              "index": {
///                                "type": "string",
///                                "maxLength": 1,
///                                "minLength": 1
///                              },
///                              "kind": {
///                                "type": "string",
///                                "enum": [
///                                  "tracked",
///                                  "untracked",
///                                  "conflict"
///                                ]
///                              },
///                              "originalPath": {
///                                "anyOf": [
///                                  {
///                                    "type": "string",
///                                    "maxLength": 4096,
///                                    "minLength": 1
///                                  },
///                                  {
///                                    "type": "null"
///                                  }
///                                ]
///                              },
///                              "path": {
///                                "type": "string",
///                                "maxLength": 4096,
///                                "minLength": 1
///                              },
///                              "submodule": {
///                                "type": "boolean"
///                              },
///                              "worktree": {
///                                "type": "string",
///                                "maxLength": 1,
///                                "minLength": 1
///                              }
///                            },
///                            "additionalProperties": false
///                          }
///                        },
///                        "gitWorkspaces": {
///                          "default": [],
///                          "type": "array",
///                          "items": {
///                            "type": "object",
///                            "required": [
///                              "branch",
///                              "path"
///                            ],
///                            "properties": {
///                              "branch": {
///                                "anyOf": [
///                                  {
///                                    "type": "string"
///                                  },
///                                  {
///                                    "type": "null"
///                                  }
///                                ]
///                              },
///                              "path": {
///                                "type": "string"
///                              }
///                            },
///                            "additionalProperties": false
///                          }
///                        },
///                        "head": {
///                          "anyOf": [
///                            {
///                              "type": "string"
///                            },
///                            {
///                              "type": "null"
///                            }
///                          ]
///                        },
///                        "kind": {
///                          "type": "string",
///                          "const": "status"
///                        },
///                        "oid": {
///                          "anyOf": [
///                            {
///                              "type": "string"
///                            },
///                            {
///                              "type": "null"
///                            }
///                          ]
///                        },
///                        "operation": {
///                          "anyOf": [
///                            {
///                              "type": "string",
///                              "enum": [
///                                "merge",
///                                "rebase",
///                                "cherry-pick",
///                                "revert",
///                                "bisect"
///                              ]
///                            },
///                            {
///                              "type": "null"
///                            }
///                          ]
///                        },
///                        "remotes": {
///                          "type": "array",
///                          "items": {
///                            "type": "string"
///                          }
///                        },
///                        "repository": {
///                          "type": "boolean"
///                        },
///                        "stashes": {
///                          "default": 0,
///                          "type": "integer",
///                          "maximum": 9007199254740991.0,
///                          "minimum": 0.0
///                        },
///                        "upstream": {
///                          "anyOf": [
///                            {
///                              "type": "string"
///                            },
///                            {
///                              "type": "null"
///                            }
///                          ]
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "area",
///                        "binary",
///                        "kind",
///                        "patch",
///                        "path",
///                        "truncated"
///                      ],
///                      "properties": {
///                        "area": {
///                          "type": "string",
///                          "enum": [
///                            "working",
///                            "staged"
///                          ]
///                        },
///                        "binary": {
///                          "type": "boolean"
///                        },
///                        "kind": {
///                          "type": "string",
///                          "const": "diff"
///                        },
///                        "patch": {
///                          "type": "string"
///                        },
///                        "path": {
///                          "type": "string",
///                          "maxLength": 4096,
///                          "minLength": 1
///                        },
///                        "truncated": {
///                          "type": "boolean"
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "kind",
///                        "status",
///                        "stderr",
///                        "stdout"
///                      ],
///                      "properties": {
///                        "kind": {
///                          "type": "string",
///                          "const": "mutation"
///                        },
///                        "status": {
///                          "type": "object",
///                          "required": [
///                            "ahead",
///                            "behind",
///                            "branches",
///                            "files",
///                            "gitWorkspaces",
///                            "head",
///                            "kind",
///                            "oid",
///                            "operation",
///                            "remotes",
///                            "repository",
///                            "stashes",
///                            "upstream"
///                          ],
///                          "properties": {
///                            "ahead": {
///                              "type": "integer",
///                              "maximum": 9007199254740991.0,
///                              "minimum": 0.0
///                            },
///                            "behind": {
///                              "type": "integer",
///                              "maximum": 9007199254740991.0,
///                              "minimum": 0.0
///                            },
///                            "branches": {
///                              "type": "array",
///                              "items": {
///                                "type": "object",
///                                "required": [
///                                  "ahead",
///                                  "current",
///                                  "name",
///                                  "remote",
///                                  "shortOid",
///                                  "upstream"
///                                ],
///                                "properties": {
///                                  "ahead": {
///                                    "default": null,
///                                    "anyOf": [
///                                      {
///                                        "type": "integer",
///                                        "maximum": 9007199254740991.0,
///                                        "minimum": 0.0
///                                      },
///                                      {
///                                        "type": "null"
///                                      }
///                                    ]
///                                  },
///                                  "current": {
///                                    "type": "boolean"
///                                  },
///                                  "name": {
///                                    "type": "string"
///                                  },
///                                  "remote": {
///                                    "type": "boolean"
///                                  },
///                                  "shortOid": {
///                                    "type": "string"
///                                  },
///                                  "upstream": {
///                                    "anyOf": [
///                                      {
///                                        "type": "string"
///                                      },
///                                      {
///                                        "type": "null"
///                                      }
///                                    ]
///                                  }
///                                },
///                                "additionalProperties": false
///                              }
///                            },
///                            "files": {
///                              "type": "array",
///                              "items": {
///                                "type": "object",
///                                "required": [
///                                  "index",
///                                  "kind",
///                                  "path",
///                                  "submodule",
///                                  "worktree"
///                                ],
///                                "properties": {
///                                  "index": {
///                                    "type": "string",
///                                    "maxLength": 1,
///                                    "minLength": 1
///                                  },
///                                  "kind": {
///                                    "type": "string",
///                                    "enum": [
///                                      "tracked",
///                                      "untracked",
///                                      "conflict"
///                                    ]
///                                  },
///                                  "originalPath": {
///                                    "anyOf": [
///                                      {
///                                        "type": "string",
///                                        "maxLength": 4096,
///                                        "minLength": 1
///                                      },
///                                      {
///                                        "type": "null"
///                                      }
///                                    ]
///                                  },
///                                  "path": {
///                                    "type": "string",
///                                    "maxLength": 4096,
///                                    "minLength": 1
///                                  },
///                                  "submodule": {
///                                    "type": "boolean"
///                                  },
///                                  "worktree": {
///                                    "type": "string",
///                                    "maxLength": 1,
///                                    "minLength": 1
///                                  }
///                                },
///                                "additionalProperties": false
///                              }
///                            },
///                            "gitWorkspaces": {
///                              "default": [],
///                              "type": "array",
///                              "items": {
///                                "type": "object",
///                                "required": [
///                                  "branch",
///                                  "path"
///                                ],
///                                "properties": {
///                                  "branch": {
///                                    "anyOf": [
///                                      {
///                                        "type": "string"
///                                      },
///                                      {
///                                        "type": "null"
///                                      }
///                                    ]
///                                  },
///                                  "path": {
///                                    "type": "string"
///                                  }
///                                },
///                                "additionalProperties": false
///                              }
///                            },
///                            "head": {
///                              "anyOf": [
///                                {
///                                  "type": "string"
///                                },
///                                {
///                                  "type": "null"
///                                }
///                              ]
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "status"
///                            },
///                            "oid": {
///                              "anyOf": [
///                                {
///                                  "type": "string"
///                                },
///                                {
///                                  "type": "null"
///                                }
///                              ]
///                            },
///                            "operation": {
///                              "anyOf": [
///                                {
///                                  "type": "string",
///                                  "enum": [
///                                    "merge",
///                                    "rebase",
///                                    "cherry-pick",
///                                    "revert",
///                                    "bisect"
///                                  ]
///                                },
///                                {
///                                  "type": "null"
///                                }
///                              ]
///                            },
///                            "remotes": {
///                              "type": "array",
///                              "items": {
///                                "type": "string"
///                              }
///                            },
///                            "repository": {
///                              "type": "boolean"
///                            },
///                            "stashes": {
///                              "default": 0,
///                              "type": "integer",
///                              "maximum": 9007199254740991.0,
///                              "minimum": 0.0
///                            },
///                            "upstream": {
///                              "anyOf": [
///                                {
///                                  "type": "string"
///                                },
///                                {
///                                  "type": "null"
///                                }
///                              ]
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        "stderr": {
///                          "type": "string"
///                        },
///                        "stdout": {
///                          "type": "string"
///                        },
///                        "workspace": {
///                          "type": "object",
///                          "required": [
///                            "branch",
///                            "id",
///                            "localPath",
///                            "name",
///                            "slug"
///                          ],
///                          "properties": {
///                            "branch": {
///                              "anyOf": [
///                                {
///                                  "type": "string"
///                                },
///                                {
///                                  "type": "null"
///                                }
///                              ]
///                            },
///                            "id": {
///                              "type": "string",
///                              "minLength": 1
///                            },
///                            "localPath": {
///                              "type": "string",
///                              "minLength": 1
///                            },
///                            "name": {
///                              "type": "string",
///                              "minLength": 1
///                            },
///                            "slug": {
///                              "type": "string",
///                              "minLength": 1
///                            }
///                          },
///                          "additionalProperties": false
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "clean",
///                        "kind",
///                        "reasons"
///                      ],
///                      "properties": {
///                        "clean": {
///                          "type": "boolean"
///                        },
///                        "kind": {
///                          "type": "string",
///                          "const": "unpublished"
///                        },
///                        "reasons": {
///                          "type": "array",
///                          "items": {
///                            "type": "string",
///                            "maxLength": 512
///                          },
///                          "maxItems": 200
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "adopted",
///                        "branch",
///                        "kind",
///                        "localPath"
///                      ],
///                      "properties": {
///                        "adopted": {
///                          "type": "boolean"
///                        },
///                        "branch": {
///                          "anyOf": [
///                            {
///                              "type": "string"
///                            },
///                            {
///                              "type": "null"
///                            }
///                          ]
///                        },
///                        "kind": {
///                          "type": "string",
///                          "const": "prepared"
///                        },
///                        "localPath": {
///                          "type": "string",
///                          "minLength": 1
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "commits",
///                        "head",
///                        "kind",
///                        "nextCursor",
///                        "upstream"
///                      ],
///                      "properties": {
///                        "commits": {
///                          "type": "array",
///                          "items": {
///                            "type": "object",
///                            "required": [
///                              "authorEmail",
///                              "authorName",
///                              "authoredAt",
///                              "committedAt",
///                              "oid",
///                              "parents",
///                              "refs",
///                              "shortOid",
///                              "subject"
///                            ],
///                            "properties": {
///                              "authorEmail": {
///                                "type": "string"
///                              },
///                              "authorName": {
///                                "type": "string"
///                              },
///                              "authoredAt": {
///                                "type": "string"
///                              },
///                              "committedAt": {
///                                "type": "string"
///                              },
///                              "oid": {
///                                "type": "string"
///                              },
///                              "parents": {
///                                "type": "array",
///                                "items": {
///                                  "type": "string"
///                                }
///                              },
///                              "refs": {
///                                "type": "array",
///                                "items": {
///                                  "type": "string"
///                                }
///                              },
///                              "shortOid": {
///                                "type": "string"
///                              },
///                              "subject": {
///                                "type": "string"
///                              }
///                            },
///                            "additionalProperties": false
///                          }
///                        },
///                        "head": {
///                          "anyOf": [
///                            {
///                              "type": "string"
///                            },
///                            {
///                              "type": "null"
///                            }
///                          ]
///                        },
///                        "kind": {
///                          "type": "string",
///                          "const": "log"
///                        },
///                        "nextCursor": {
///                          "anyOf": [
///                            {
///                              "type": "string"
///                            },
///                            {
///                              "type": "null"
///                            }
///                          ]
///                        },
///                        "upstream": {
///                          "anyOf": [
///                            {
///                              "type": "string"
///                            },
///                            {
///                              "type": "null"
///                            }
///                          ]
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "files",
///                        "kind",
///                        "message",
///                        "oid"
///                      ],
///                      "properties": {
///                        "files": {
///                          "type": "array",
///                          "items": {
///                            "type": "object",
///                            "required": [
///                              "additions",
///                              "binary",
///                              "deletions",
///                              "path",
///                              "status"
///                            ],
///                            "properties": {
///                              "additions": {
///                                "type": "integer",
///                                "maximum": 9007199254740991.0,
///                                "minimum": 0.0
///                              },
///                              "binary": {
///                                "type": "boolean"
///                              },
///                              "deletions": {
///                                "type": "integer",
///                                "maximum": 9007199254740991.0,
///                                "minimum": 0.0
///                              },
///                              "oldPath": {
///                                "type": "string"
///                              },
///                              "path": {
///                                "type": "string"
///                              },
///                              "status": {
///                                "type": "string",
///                                "enum": [
///                                  "A",
///                                  "M",
///                                  "D",
///                                  "R",
///                                  "C",
///                                  "T"
///                                ]
///                              }
///                            },
///                            "additionalProperties": false
///                          }
///                        },
///                        "kind": {
///                          "type": "string",
///                          "const": "commit_detail"
///                        },
///                        "message": {
///                          "type": "string"
///                        },
///                        "oid": {
///                          "type": "string"
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "binary",
///                        "kind",
///                        "oid",
///                        "patch",
///                        "path",
///                        "truncated"
///                      ],
///                      "properties": {
///                        "binary": {
///                          "type": "boolean"
///                        },
///                        "kind": {
///                          "type": "string",
///                          "const": "commit_diff"
///                        },
///                        "oid": {
///                          "type": "string"
///                        },
///                        "patch": {
///                          "type": "string"
///                        },
///                        "path": {
///                          "anyOf": [
///                            {
///                              "type": "string"
///                            },
///                            {
///                              "type": "null"
///                            }
///                          ]
///                        },
///                        "truncated": {
///                          "type": "boolean"
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "area",
///                        "kind",
///                        "patch",
///                        "truncated",
///                        "untrackedOmitted"
///                      ],
///                      "properties": {
///                        "area": {
///                          "type": "string",
///                          "enum": [
///                            "working",
///                            "staged"
///                          ]
///                        },
///                        "kind": {
///                          "type": "string",
///                          "const": "diff_all"
///                        },
///                        "patch": {
///                          "type": "string"
///                        },
///                        "truncated": {
///                          "type": "boolean"
///                        },
///                        "untrackedOmitted": {
///                          "type": "boolean"
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "base",
///                        "files",
///                        "head",
///                        "kind",
///                        "mergeBase",
///                        "patch",
///                        "truncated"
///                      ],
///                      "properties": {
///                        "base": {
///                          "type": "string"
///                        },
///                        "files": {
///                          "type": "array",
///                          "items": {
///                            "type": "object",
///                            "required": [
///                              "additions",
///                              "binary",
///                              "deletions",
///                              "path",
///                              "status"
///                            ],
///                            "properties": {
///                              "additions": {
///                                "type": "integer",
///                                "maximum": 9007199254740991.0,
///                                "minimum": 0.0
///                              },
///                              "binary": {
///                                "type": "boolean"
///                              },
///                              "deletions": {
///                                "type": "integer",
///                                "maximum": 9007199254740991.0,
///                                "minimum": 0.0
///                              },
///                              "oldPath": {
///                                "type": "string"
///                              },
///                              "path": {
///                                "type": "string"
///                              },
///                              "status": {
///                                "type": "string",
///                                "enum": [
///                                  "A",
///                                  "M",
///                                  "D",
///                                  "R",
///                                  "C",
///                                  "T"
///                                ]
///                              }
///                            },
///                            "additionalProperties": false
///                          }
///                        },
///                        "head": {
///                          "type": "string"
///                        },
///                        "kind": {
///                          "type": "string",
///                          "const": "range_diff"
///                        },
///                        "mergeBase": {
///                          "type": "string"
///                        },
///                        "patch": {
///                          "type": "string"
///                        },
///                        "truncated": {
///                          "type": "boolean"
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "branch",
///                        "files",
///                        "kind",
///                        "patch",
///                        "truncated"
///                      ],
///                      "properties": {
///                        "branch": {
///                          "anyOf": [
///                            {
///                              "type": "string"
///                            },
///                            {
///                              "type": "null"
///                            }
///                          ]
///                        },
///                        "files": {
///                          "type": "array",
///                          "items": {
///                            "type": "object",
///                            "required": [
///                              "additions",
///                              "binary",
///                              "deletions",
///                              "path",
///                              "status"
///                            ],
///                            "properties": {
///                              "additions": {
///                                "type": "integer",
///                                "maximum": 9007199254740991.0,
///                                "minimum": 0.0
///                              },
///                              "binary": {
///                                "type": "boolean"
///                              },
///                              "deletions": {
///                                "type": "integer",
///                                "maximum": 9007199254740991.0,
///                                "minimum": 0.0
///                              },
///                              "oldPath": {
///                                "type": "string"
///                              },
///                              "path": {
///                                "type": "string"
///                              },
///                              "status": {
///                                "type": "string",
///                                "enum": [
///                                  "A",
///                                  "M",
///                                  "D",
///                                  "R",
///                                  "C",
///                                  "T"
///                                ]
///                              }
///                            },
///                            "additionalProperties": false
///                          }
///                        },
///                        "kind": {
///                          "type": "string",
///                          "const": "staged_context"
///                        },
///                        "patch": {
///                          "type": "string"
///                        },
///                        "truncated": {
///                          "type": "boolean"
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "base",
///                        "commits",
///                        "files",
///                        "head",
///                        "kind",
///                        "mergeBase",
///                        "patch",
///                        "truncated"
///                      ],
///                      "properties": {
///                        "base": {
///                          "type": "string"
///                        },
///                        "commits": {
///                          "type": "array",
///                          "items": {
///                            "type": "object",
///                            "required": [
///                              "author",
///                              "body",
///                              "oid",
///                              "subject"
///                            ],
///                            "properties": {
///                              "author": {
///                                "type": "string"
///                              },
///                              "body": {
///                                "type": "string"
///                              },
///                              "oid": {
///                                "type": "string"
///                              },
///                              "subject": {
///                                "type": "string"
///                              }
///                            },
///                            "additionalProperties": false
///                          },
///                          "maxItems": 40
///                        },
///                        "files": {
///                          "type": "array",
///                          "items": {
///                            "type": "object",
///                            "required": [
///                              "additions",
///                              "binary",
///                              "deletions",
///                              "path",
///                              "status"
///                            ],
///                            "properties": {
///                              "additions": {
///                                "type": "integer",
///                                "maximum": 9007199254740991.0,
///                                "minimum": 0.0
///                              },
///                              "binary": {
///                                "type": "boolean"
///                              },
///                              "deletions": {
///                                "type": "integer",
///                                "maximum": 9007199254740991.0,
///                                "minimum": 0.0
///                              },
///                              "oldPath": {
///                                "type": "string"
///                              },
///                              "path": {
///                                "type": "string"
///                              },
///                              "status": {
///                                "type": "string",
///                                "enum": [
///                                  "A",
///                                  "M",
///                                  "D",
///                                  "R",
///                                  "C",
///                                  "T"
///                                ]
///                              }
///                            },
///                            "additionalProperties": false
///                          }
///                        },
///                        "head": {
///                          "type": "string"
///                        },
///                        "kind": {
///                          "type": "string",
///                          "const": "range_context"
///                        },
///                        "mergeBase": {
///                          "type": "string"
///                        },
///                        "patch": {
///                          "type": "string"
///                        },
///                        "truncated": {
///                          "type": "boolean"
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "entries",
///                        "kind"
///                      ],
///                      "properties": {
///                        "entries": {
///                          "type": "array",
///                          "items": {
///                            "type": "object",
///                            "required": [
///                              "createdAt",
///                              "index",
///                              "message"
///                            ],
///                            "properties": {
///                              "createdAt": {
///                                "type": "string"
///                              },
///                              "index": {
///                                "type": "integer",
///                                "maximum": 9007199254740991.0,
///                                "minimum": 0.0
///                              },
///                              "message": {
///                                "type": "string"
///                              }
///                            },
///                            "additionalProperties": false
///                          }
///                        },
///                        "kind": {
///                          "type": "string",
///                          "const": "stash_list"
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "entries",
///                        "kind",
///                        "path",
///                        "truncated"
///                      ],
///                      "properties": {
///                        "entries": {
///                          "type": "array",
///                          "items": {
///                            "type": "object",
///                            "required": [
///                              "ignored",
///                              "name",
///                              "path",
///                              "type"
///                            ],
///                            "properties": {
///                              "ignored": {
///                                "type": "boolean"
///                              },
///                              "name": {
///                                "type": "string"
///                              },
///                              "path": {
///                                "type": "string"
///                              },
///                              "size": {
///                                "type": "integer",
///                                "maximum": 9007199254740991.0,
///                                "minimum": 0.0
///                              },
///                              "type": {
///                                "type": "string",
///                                "enum": [
///                                  "file",
///                                  "directory",
///                                  "symlink"
///                                ]
///                              }
///                            },
///                            "additionalProperties": false
///                          }
///                        },
///                        "kind": {
///                          "type": "string",
///                          "const": "tree"
///                        },
///                        "path": {
///                          "type": "string"
///                        },
///                        "truncated": {
///                          "type": "boolean"
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "binary",
///                        "content",
///                        "encoding",
///                        "kind",
///                        "mime",
///                        "path",
///                        "size",
///                        "token",
///                        "truncated"
///                      ],
///                      "properties": {
///                        "binary": {
///                          "type": "boolean"
///                        },
///                        "content": {
///                          "type": "string"
///                        },
///                        "encoding": {
///                          "type": "string",
///                          "enum": [
///                            "text",
///                            "base64"
///                          ]
///                        },
///                        "kind": {
///                          "type": "string",
///                          "const": "file"
///                        },
///                        "mime": {
///                          "anyOf": [
///                            {
///                              "type": "string"
///                            },
///                            {
///                              "type": "null"
///                            }
///                          ]
///                        },
///                        "path": {
///                          "type": "string"
///                        },
///                        "size": {
///                          "type": "integer",
///                          "maximum": 9007199254740991.0,
///                          "minimum": 0.0
///                        },
///                        "token": {
///                          "type": "string"
///                        },
///                        "truncated": {
///                          "type": "boolean"
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "kind",
///                        "path",
///                        "status",
///                        "token"
///                      ],
///                      "properties": {
///                        "kind": {
///                          "type": "string",
///                          "const": "file_write"
///                        },
///                        "path": {
///                          "type": "string"
///                        },
///                        "status": {
///                          "type": "string",
///                          "enum": [
///                            "written",
///                            "conflict"
///                          ]
///                        },
///                        "token": {
///                          "type": "string"
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "files",
///                        "filesSearched",
///                        "filesSkipped",
///                        "kind",
///                        "totalMatches",
///                        "truncated"
///                      ],
///                      "properties": {
///                        "files": {
///                          "type": "array",
///                          "items": {
///                            "type": "object",
///                            "required": [
///                              "matches",
///                              "path",
///                              "token",
///                              "truncated"
///                            ],
///                            "properties": {
///                              "matches": {
///                                "type": "array",
///                                "items": {
///                                  "type": "object",
///                                  "required": [
///                                    "column",
///                                    "length",
///                                    "line",
///                                    "preview",
///                                    "previewOffset"
///                                  ],
///                                  "properties": {
///                                    "column": {
///                                      "type": "integer",
///                                      "maximum": 9007199254740991.0,
///                                      "minimum": 1.0
///                                    },
///                                    "length": {
///                                      "type": "integer",
///                                      "maximum": 9007199254740991.0,
///                                      "minimum": 0.0
///                                    },
///                                    "line": {
///                                      "type": "integer",
///                                      "maximum": 9007199254740991.0,
///                                      "minimum": 1.0
///                                    },
///                                    "preview": {
///                                      "type": "string"
///                                    },
///                                    "previewOffset": {
///                                      "type": "integer",
///                                      "maximum": 9007199254740991.0,
///                                      "minimum": 0.0
///                                    }
///                                  },
///                                  "additionalProperties": false
///                                }
///                              },
///                              "path": {
///                                "type": "string"
///                              },
///                              "token": {
///                                "type": "string"
///                              },
///                              "truncated": {
///                                "type": "boolean"
///                              }
///                            },
///                            "additionalProperties": false
///                          }
///                        },
///                        "filesSearched": {
///                          "type": "integer",
///                          "maximum": 9007199254740991.0,
///                          "minimum": 0.0
///                        },
///                        "filesSkipped": {
///                          "type": "integer",
///                          "maximum": 9007199254740991.0,
///                          "minimum": 0.0
///                        },
///                        "kind": {
///                          "type": "string",
///                          "const": "search"
///                        },
///                        "totalMatches": {
///                          "type": "integer",
///                          "maximum": 9007199254740991.0,
///                          "minimum": 0.0
///                        },
///                        "truncated": {
///                          "type": "boolean"
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "files",
///                        "kind",
///                        "replaced",
///                        "skipped"
///                      ],
///                      "properties": {
///                        "files": {
///                          "type": "array",
///                          "items": {
///                            "type": "object",
///                            "required": [
///                              "path",
///                              "replaced",
///                              "status"
///                            ],
///                            "properties": {
///                              "path": {
///                                "type": "string"
///                              },
///                              "replaced": {
///                                "type": "integer",
///                                "maximum": 9007199254740991.0,
///                                "minimum": 0.0
///                              },
///                              "status": {
///                                "type": "string",
///                                "enum": [
///                                  "ok",
///                                  "conflict",
///                                  "missing",
///                                  "skipped"
///                                ]
///                              }
///                            },
///                            "additionalProperties": false
///                          }
///                        },
///                        "kind": {
///                          "type": "string",
///                          "const": "replace"
///                        },
///                        "replaced": {
///                          "type": "integer",
///                          "maximum": 9007199254740991.0,
///                          "minimum": 0.0
///                        },
///                        "skipped": {
///                          "type": "integer",
///                          "maximum": 9007199254740991.0,
///                          "minimum": 0.0
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "kind",
///                        "state"
///                      ],
///                      "properties": {
///                        "account": {
///                          "type": "object",
///                          "required": [
///                            "email",
///                            "label",
///                            "newRegistration",
///                            "planUsage",
///                            "scopes"
///                          ],
///                          "properties": {
///                            "email": {
///                              "anyOf": [
///                                {
///                                  "type": "string",
///                                  "maxLength": 320,
///                                  "minLength": 1
///                                },
///                                {
///                                  "type": "null"
///                                }
///                              ]
///                            },
///                            "label": {
///                              "type": "string",
///                              "maxLength": 256,
///                              "minLength": 1
///                            },
///                            "newRegistration": {
///                              "type": "boolean"
///                            },
///                            "planUsage": {
///                              "type": "boolean"
///                            },
///                            "scopes": {
///                              "type": "array",
///                              "items": {
///                                "type": "string",
///                                "maxLength": 128,
///                                "minLength": 1
///                              },
///                              "maxItems": 16
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        "kind": {
///                          "type": "string",
///                          "const": "chatgpt_status"
///                        },
///                        "loginError": {
///                          "type": "string",
///                          "enum": [
///                            "login_timeout",
///                            "state_mismatch",
///                            "plan_disabled",
///                            "missing_code",
///                            "registration_incomplete",
///                            "client_mismatch",
///                            "temporarily_unavailable",
///                            "invalid_token_response",
///                            "invalid_id_token",
///                            "subject_mismatch",
///                            "reconnect",
///                            "client_invalid",
///                            "cancelled"
///                          ]
///                        },
///                        "pending": {
///                          "type": "object",
///                          "required": [
///                            "expiresAt"
///                          ],
///                          "properties": {
///                            "expiresAt": {
///                              "type": "integer",
///                              "maximum": 9007199254740991.0,
///                              "minimum": 0.0
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        "state": {
///                          "type": "string",
///                          "enum": [
///                            "signed_out",
///                            "pending",
///                            "ready",
///                            "plan_disabled",
///                            "reconnect",
///                            "client_invalid",
///                            "unavailable_on_cloud"
///                          ]
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "authorizeUrl",
///                        "expiresAt",
///                        "kind"
///                      ],
///                      "properties": {
///                        "authorizeUrl": {
///                          "type": "string",
///                          "format": "uri",
///                          "maxLength": 4096
///                        },
///                        "expiresAt": {
///                          "type": "integer",
///                          "maximum": 9007199254740991.0,
///                          "minimum": 0.0
///                        },
///                        "kind": {
///                          "type": "string",
///                          "const": "chatgpt_login"
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "kind",
///                        "revocationConfirmed"
///                      ],
///                      "properties": {
///                        "kind": {
///                          "type": "string",
///                          "const": "chatgpt_logout"
///                        },
///                        "revocationConfirmed": {
///                          "type": "boolean"
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "type": "object",
///                      "required": [
///                        "kind",
///                        "models"
///                      ],
///                      "properties": {
///                        "kind": {
///                          "type": "string",
///                          "const": "chatgpt_models"
///                        },
///                        "models": {
///                          "type": "array",
///                          "items": {
///                            "type": "object",
///                            "required": [
///                              "id",
///                              "label"
///                            ],
///                            "properties": {
///                              "id": {
///                                "type": "string",
///                                "maxLength": 128,
///                                "minLength": 1,
///                                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$"
///                              },
///                              "label": {
///                                "type": "string",
///                                "maxLength": 256,
///                                "minLength": 1
///                              }
///                            },
///                            "additionalProperties": false
///                          },
///                          "maxItems": 50
///                        }
///                      },
///                      "additionalProperties": false
///                    },
///                    {
///                      "oneOf": [
///                        {
///                          "type": "object",
///                          "required": [
///                            "kind",
///                            "model",
///                            "outcome",
///                            "text"
///                          ],
///                          "properties": {
///                            "kind": {
///                              "type": "string",
///                              "const": "chatgpt_generation"
///                            },
///                            "model": {
///                              "type": "string",
///                              "maxLength": 128,
///                              "minLength": 1,
///                              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$"
///                            },
///                            "outcome": {
///                              "type": "string",
///                              "const": "completed"
///                            },
///                            "text": {
///                              "type": "string",
///                              "maxLength": 200000
///                            }
///                          },
///                          "additionalProperties": false
///                        },
///                        {
///                          "type": "object",
///                          "required": [
///                            "kind",
///                            "outcome",
///                            "reason"
///                          ],
///                          "properties": {
///                            "code": {
///                              "type": "string",
///                              "maxLength": 128,
///                              "minLength": 1
///                            },
///                            "httpStatus": {
///                              "type": "integer",
///                              "maximum": 599.0,
///                              "minimum": 100.0
///                            },
///                            "kind": {
///                              "type": "string",
///                              "const": "chatgpt_generation"
///                            },
///                            "outcome": {
///                              "type": "string",
///                              "const": "failed"
///                            },
///                            "param": {
///                              "type": "string",
///                              "maxLength": 128,
///                              "minLength": 1
///                            },
///                            "reason": {
///                              "type": "string",
///                              "enum": [
///                                "usage_limit",
///                                "not_eligible",
///                                "plan_disabled",
///                                "reconnect",
///                                "unsupported",
///                                "route_not_supported",
///                                "permission",
///                                "region_or_policy",
///                                "temporarily_unavailable",
///                                "incomplete",
///                                "interrupted",
///                                "model_unavailable",
///                                "signed_out",
///                                "failed"
///                              ]
///                            },
///                            "requestId": {
///                              "type": "string",
///                              "maxLength": 128,
///                              "minLength": 1
///                            }
///                          },
///                          "additionalProperties": false
///                        }
///                      ]
///                    }
///                  ]
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "error",
///                "ok"
///              ],
///              "properties": {
///                "error": {
///                  "type": "object",
///                  "required": [
///                    "code",
///                    "message"
///                  ],
///                  "properties": {
///                    "code": {
///                      "type": "string",
///                      "enum": [
///                        "LOCAL_EXECUTOR_OFFLINE",
///                        "EXECUTOR_WAKING",
///                        "TOOL_TIMEOUT",
///                        "CANCELLED",
///                        "PATH_ESCAPE",
///                        "PATH_NOT_FOUND",
///                        "TOOL_FAILED",
///                        "INVALID_ARGUMENTS",
///                        "UNKNOWN_TOOL",
///                        "UNKNOWN_PROJECT",
///                        "UNKNOWN_WORKSPACE",
///                        "WORKSPACE_UNAVAILABLE",
///                        "UNKNOWN_PROCESS",
///                        "NO_ACTIVE_PROJECT",
///                        "FORBIDDEN",
///                        "APPROVAL_DECLINED",
///                        "APPROVAL_TIMEOUT",
///                        "INTERNAL_ERROR"
///                      ]
///                    },
///                    "message": {
///                      "type": "string"
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                "ok": {
///                  "type": "boolean",
///                  "const": false
///                }
///              },
///              "additionalProperties": false
///            }
///          ]
///        },
///        "type": {
///          "type": "string",
///          "const": "workspace.result"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "approved",
///        "id",
///        "type"
///      ],
///      "properties": {
///        "approved": {
///          "type": "boolean"
///        },
///        "id": {
///          "type": "string"
///        },
///        "type": {
///          "type": "string",
///          "const": "approval.answer"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "sessionId",
///        "type"
///      ],
///      "properties": {
///        "sessionId": {
///          "type": "string",
///          "maxLength": 128,
///          "minLength": 1
///        },
///        "type": {
///          "type": "string",
///          "const": "terminal.opened"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "data",
///        "sessionId",
///        "type"
///      ],
///      "properties": {
///        "data": {
///          "type": "string",
///          "maxLength": 128000
///        },
///        "sessionId": {
///          "type": "string",
///          "maxLength": 128,
///          "minLength": 1
///        },
///        "type": {
///          "type": "string",
///          "const": "terminal.output"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "exitCode",
///        "sessionId",
///        "type"
///      ],
///      "properties": {
///        "exitCode": {
///          "anyOf": [
///            {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": -9007199254740991.0
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "sessionId": {
///          "type": "string",
///          "maxLength": 128,
///          "minLength": 1
///        },
///        "type": {
///          "type": "string",
///          "const": "terminal.exit"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "message",
///        "sessionId",
///        "type"
///      ],
///      "properties": {
///        "message": {
///          "type": "string",
///          "maxLength": 2048
///        },
///        "sessionId": {
///          "type": "string",
///          "maxLength": 128,
///          "minLength": 1
///        },
///        "type": {
///          "type": "string",
///          "const": "terminal.error"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "hook",
///        "run",
///        "type"
///      ],
///      "properties": {
///        "hook": {
///          "type": "string",
///          "enum": [
///            "install",
///            "resume"
///          ]
///        },
///        "run": {
///          "type": "object",
///          "required": [
///            "exitCode",
///            "finishedAt",
///            "runId",
///            "scriptSha256",
///            "source",
///            "startedAt",
///            "status",
///            "trigger",
///            "truncated"
///          ],
///          "properties": {
///            "exitCode": {
///              "anyOf": [
///                {
///                  "type": "integer",
///                  "maximum": 9007199254740991.0,
///                  "minimum": -9007199254740991.0
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            },
///            "finishedAt": {
///              "anyOf": [
///                {
///                  "type": "integer",
///                  "maximum": 9007199254740991.0,
///                  "minimum": -9007199254740991.0
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            },
///            "output": {
///              "type": "string",
///              "maxLength": 16000
///            },
///            "runId": {
///              "type": "string",
///              "maxLength": 64,
///              "minLength": 1
///            },
///            "scriptSha256": {
///              "anyOf": [
///                {
///                  "type": "string",
///                  "maxLength": 64,
///                  "minLength": 64
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            },
///            "source": {
///              "type": "string",
///              "enum": [
///                "dashboard",
///                "repository",
///                "none"
///              ]
///            },
///            "startedAt": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": -9007199254740991.0
///            },
///            "status": {
///              "type": "string",
///              "enum": [
///                "running",
///                "ok",
///                "failed",
///                "timed_out",
///                "skipped"
///              ]
///            },
///            "trigger": {
///              "type": "string",
///              "enum": [
///                "setup",
///                "changed",
///                "manual",
///                "cold",
///                "warm"
///              ]
///            },
///            "truncated": {
///              "default": false,
///              "type": "boolean"
///            }
///          },
///          "additionalProperties": false
///        },
///        "type": {
///          "type": "string",
///          "const": "cloud.hook.state"
///        }
///      },
///      "additionalProperties": false
///    }
///  ],
///  "$schema": "https://json-schema.org/draft/2020-12/schema"
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum ExeoraProtocolTypesExecutorMessage {
    #[serde(rename = "hello")]
    Hello {
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        capabilities: ::std::option::Option<ExeoraProtocolTypesExecutorMessageCapabilities>,
        #[serde(rename = "cliVersion")]
        cli_version: ::std::string::String,
        #[serde(rename = "deviceId")]
        device_id: ::std::string::String,
        platform: ::std::string::String,
        projects: ::std::vec::Vec<ExeoraProtocolTypesExecutorMessageProjectsItem>,
        #[serde(rename = "protocolVersion")]
        protocol_version: i64,
    },
    #[serde(rename = "heartbeat")]
    Heartbeat {
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        at: ::std::option::Option<i64>,
    },
    #[serde(rename = "presence")]
    Presence { at: i64 },
    #[serde(rename = "mcp.catalog")]
    McpCatalog {
        #[serde(rename = "projectId")]
        project_id: ::std::string::String,
        tools: ::std::vec::Vec<ExeoraProtocolTypesExecutorMessageToolsItem>,
    },
    #[serde(rename = "tool.result")]
    ToolResult {
        #[serde(rename = "durationMs")]
        duration_ms: i64,
        #[serde(rename = "requestId")]
        request_id: ::std::string::String,
        result: ExeoraProtocolTypesExecutorMessageResult,
    },
    #[serde(rename = "mcp.result")]
    McpResult {
        #[serde(rename = "durationMs")]
        duration_ms: i64,
        #[serde(rename = "requestId")]
        request_id: ::std::string::String,
        result: ExeoraProtocolTypesExecutorMessageResult,
    },
    #[serde(rename = "workspace.result")]
    WorkspaceResult {
        #[serde(rename = "durationMs")]
        duration_ms: i64,
        #[serde(rename = "requestId")]
        request_id: ::std::string::String,
        result: ExeoraProtocolTypesExecutorMessageResult,
    },
    #[serde(rename = "approval.answer")]
    ApprovalAnswer {
        approved: bool,
        id: ::std::string::String,
    },
    #[serde(rename = "terminal.opened")]
    TerminalOpened {
        #[serde(rename = "sessionId")]
        session_id: ExeoraProtocolTypesExecutorMessageSessionId,
    },
    #[serde(rename = "terminal.output")]
    TerminalOutput {
        data: ExeoraProtocolTypesExecutorMessageData,
        #[serde(rename = "sessionId")]
        session_id: ExeoraProtocolTypesExecutorMessageSessionId,
    },
    #[serde(rename = "terminal.exit")]
    TerminalExit {
        #[serde(rename = "exitCode")]
        exit_code: ::std::option::Option<i64>,
        #[serde(rename = "sessionId")]
        session_id: ExeoraProtocolTypesExecutorMessageSessionId,
    },
    #[serde(rename = "terminal.error")]
    TerminalError {
        message: ExeoraProtocolTypesExecutorMessageMessage,
        #[serde(rename = "sessionId")]
        session_id: ExeoraProtocolTypesExecutorMessageSessionId,
    },
    #[serde(rename = "cloud.hook.state")]
    CloudHookState {
        hook: ExeoraProtocolTypesExecutorMessageHook,
        run: ExeoraProtocolTypesExecutorMessageRun,
    },
}
///`ExeoraProtocolTypesExecutorMessageCapabilities`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "prompt",
///    "tools"
///  ],
///  "properties": {
///    "features": {
///      "type": "array",
///      "items": {
///        "type": "string",
///        "maxLength": 64
///      },
///      "maxItems": 32
///    },
///    "prompt": {
///      "type": "boolean"
///    },
///    "tools": {
///      "type": "array",
///      "items": {
///        "type": "string",
///        "maxLength": 64
///      },
///      "maxItems": 64
///    },
///    "workspaceRouting": {
///      "type": "boolean"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageCapabilities {
    #[serde(default, skip_serializing_if = "::std::vec::Vec::is_empty")]
    pub features: ::std::vec::Vec<ExeoraProtocolTypesExecutorMessageCapabilitiesFeaturesItem>,
    pub prompt: bool,
    pub tools: ::std::vec::Vec<ExeoraProtocolTypesExecutorMessageCapabilitiesToolsItem>,
    #[serde(
        rename = "workspaceRouting",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub workspace_routing: ::std::option::Option<bool>,
}
///`ExeoraProtocolTypesExecutorMessageCapabilitiesFeaturesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 64
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageCapabilitiesFeaturesItem(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageCapabilitiesFeaturesItem {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageCapabilitiesFeaturesItem>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageCapabilitiesFeaturesItem) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageCapabilitiesFeaturesItem {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 64usize {
            return Err("longer than 64 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageCapabilitiesFeaturesItem {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageCapabilitiesFeaturesItem
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageCapabilitiesFeaturesItem
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesExecutorMessageCapabilitiesFeaturesItem {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageCapabilitiesToolsItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 64
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageCapabilitiesToolsItem(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageCapabilitiesToolsItem {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageCapabilitiesToolsItem>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageCapabilitiesToolsItem) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageCapabilitiesToolsItem {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 64usize {
            return Err("longer than 64 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageCapabilitiesToolsItem {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageCapabilitiesToolsItem
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageCapabilitiesToolsItem
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesExecutorMessageCapabilitiesToolsItem {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageData`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 128000
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageData(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageData {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageData> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesExecutorMessageData) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageData {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 128000usize {
            return Err("longer than 128000 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageData {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesExecutorMessageData {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesExecutorMessageData {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesExecutorMessageData {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageHook`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "install",
///    "resume"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageHook {
    #[serde(rename = "install")]
    Install,
    #[serde(rename = "resume")]
    Resume,
}
impl ::std::fmt::Display for ExeoraProtocolTypesExecutorMessageHook {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Install => f.write_str("install"),
            Self::Resume => f.write_str("resume"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageHook {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "install" => Ok(Self::Install),
            "resume" => Ok(Self::Resume),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageHook {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesExecutorMessageHook {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesExecutorMessageHook {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageMessage`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 2048
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageMessage(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageMessage {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageMessage> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesExecutorMessageMessage) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageMessage {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 2048usize {
            return Err("longer than 2048 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageMessage {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesExecutorMessageMessage {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesExecutorMessageMessage {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesExecutorMessageMessage {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageProjectsItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "id",
///    "slug"
///  ],
///  "properties": {
///    "id": {
///      "type": "string"
///    },
///    "slug": {
///      "type": "string"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageProjectsItem {
    pub id: ::std::string::String,
    pub slug: ::std::string::String,
}
///`ExeoraProtocolTypesExecutorMessageResult`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "object",
///      "required": [
///        "ok",
///        "value"
///      ],
///      "properties": {
///        "ok": {
///          "type": "boolean",
///          "const": true
///        },
///        "value": {}
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "error",
///        "ok"
///      ],
///      "properties": {
///        "error": {
///          "type": "object",
///          "required": [
///            "code",
///            "message"
///          ],
///          "properties": {
///            "code": {
///              "type": "string",
///              "enum": [
///                "LOCAL_EXECUTOR_OFFLINE",
///                "EXECUTOR_WAKING",
///                "TOOL_TIMEOUT",
///                "CANCELLED",
///                "PATH_ESCAPE",
///                "PATH_NOT_FOUND",
///                "TOOL_FAILED",
///                "INVALID_ARGUMENTS",
///                "UNKNOWN_TOOL",
///                "UNKNOWN_PROJECT",
///                "UNKNOWN_WORKSPACE",
///                "WORKSPACE_UNAVAILABLE",
///                "UNKNOWN_PROCESS",
///                "NO_ACTIVE_PROJECT",
///                "FORBIDDEN",
///                "APPROVAL_DECLINED",
///                "APPROVAL_TIMEOUT",
///                "INTERNAL_ERROR"
///              ]
///            },
///            "message": {
///              "type": "string"
///            }
///          },
///          "additionalProperties": false
///        },
///        "ok": {
///          "type": "boolean",
///          "const": false
///        }
///      },
///      "additionalProperties": false
///    }
///  ]
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(untagged, deny_unknown_fields)]
pub enum ExeoraProtocolTypesExecutorMessageResult {
    Variant0 {
        ok: bool,
        value: ::serde_json::Value,
    },
    Variant1 {
        error: ExeoraProtocolTypesExecutorMessageResultVariant1Error,
        ok: bool,
    },
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0Value`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "object",
///      "required": [
///        "ahead",
///        "behind",
///        "branches",
///        "files",
///        "gitWorkspaces",
///        "head",
///        "kind",
///        "oid",
///        "operation",
///        "remotes",
///        "repository",
///        "stashes",
///        "upstream"
///      ],
///      "properties": {
///        "ahead": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": 0.0
///        },
///        "behind": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": 0.0
///        },
///        "branches": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "ahead",
///              "current",
///              "name",
///              "remote",
///              "shortOid",
///              "upstream"
///            ],
///            "properties": {
///              "ahead": {
///                "default": null,
///                "anyOf": [
///                  {
///                    "type": "integer",
///                    "maximum": 9007199254740991.0,
///                    "minimum": 0.0
///                  },
///                  {
///                    "type": "null"
///                  }
///                ]
///              },
///              "current": {
///                "type": "boolean"
///              },
///              "name": {
///                "type": "string"
///              },
///              "remote": {
///                "type": "boolean"
///              },
///              "shortOid": {
///                "type": "string"
///              },
///              "upstream": {
///                "anyOf": [
///                  {
///                    "type": "string"
///                  },
///                  {
///                    "type": "null"
///                  }
///                ]
///              }
///            },
///            "additionalProperties": false
///          }
///        },
///        "files": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "index",
///              "kind",
///              "path",
///              "submodule",
///              "worktree"
///            ],
///            "properties": {
///              "index": {
///                "type": "string",
///                "maxLength": 1,
///                "minLength": 1
///              },
///              "kind": {
///                "type": "string",
///                "enum": [
///                  "tracked",
///                  "untracked",
///                  "conflict"
///                ]
///              },
///              "originalPath": {
///                "anyOf": [
///                  {
///                    "type": "string",
///                    "maxLength": 4096,
///                    "minLength": 1
///                  },
///                  {
///                    "type": "null"
///                  }
///                ]
///              },
///              "path": {
///                "type": "string",
///                "maxLength": 4096,
///                "minLength": 1
///              },
///              "submodule": {
///                "type": "boolean"
///              },
///              "worktree": {
///                "type": "string",
///                "maxLength": 1,
///                "minLength": 1
///              }
///            },
///            "additionalProperties": false
///          }
///        },
///        "gitWorkspaces": {
///          "default": [],
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "branch",
///              "path"
///            ],
///            "properties": {
///              "branch": {
///                "anyOf": [
///                  {
///                    "type": "string"
///                  },
///                  {
///                    "type": "null"
///                  }
///                ]
///              },
///              "path": {
///                "type": "string"
///              }
///            },
///            "additionalProperties": false
///          }
///        },
///        "head": {
///          "anyOf": [
///            {
///              "type": "string"
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "kind": {
///          "type": "string",
///          "const": "status"
///        },
///        "oid": {
///          "anyOf": [
///            {
///              "type": "string"
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "operation": {
///          "anyOf": [
///            {
///              "type": "string",
///              "enum": [
///                "merge",
///                "rebase",
///                "cherry-pick",
///                "revert",
///                "bisect"
///              ]
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "remotes": {
///          "type": "array",
///          "items": {
///            "type": "string"
///          }
///        },
///        "repository": {
///          "type": "boolean"
///        },
///        "stashes": {
///          "default": 0,
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": 0.0
///        },
///        "upstream": {
///          "anyOf": [
///            {
///              "type": "string"
///            },
///            {
///              "type": "null"
///            }
///          ]
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "area",
///        "binary",
///        "kind",
///        "patch",
///        "path",
///        "truncated"
///      ],
///      "properties": {
///        "area": {
///          "type": "string",
///          "enum": [
///            "working",
///            "staged"
///          ]
///        },
///        "binary": {
///          "type": "boolean"
///        },
///        "kind": {
///          "type": "string",
///          "const": "diff"
///        },
///        "patch": {
///          "type": "string"
///        },
///        "path": {
///          "type": "string",
///          "maxLength": 4096,
///          "minLength": 1
///        },
///        "truncated": {
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "kind",
///        "status",
///        "stderr",
///        "stdout"
///      ],
///      "properties": {
///        "kind": {
///          "type": "string",
///          "const": "mutation"
///        },
///        "status": {
///          "type": "object",
///          "required": [
///            "ahead",
///            "behind",
///            "branches",
///            "files",
///            "gitWorkspaces",
///            "head",
///            "kind",
///            "oid",
///            "operation",
///            "remotes",
///            "repository",
///            "stashes",
///            "upstream"
///          ],
///          "properties": {
///            "ahead": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": 0.0
///            },
///            "behind": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": 0.0
///            },
///            "branches": {
///              "type": "array",
///              "items": {
///                "type": "object",
///                "required": [
///                  "ahead",
///                  "current",
///                  "name",
///                  "remote",
///                  "shortOid",
///                  "upstream"
///                ],
///                "properties": {
///                  "ahead": {
///                    "default": null,
///                    "anyOf": [
///                      {
///                        "type": "integer",
///                        "maximum": 9007199254740991.0,
///                        "minimum": 0.0
///                      },
///                      {
///                        "type": "null"
///                      }
///                    ]
///                  },
///                  "current": {
///                    "type": "boolean"
///                  },
///                  "name": {
///                    "type": "string"
///                  },
///                  "remote": {
///                    "type": "boolean"
///                  },
///                  "shortOid": {
///                    "type": "string"
///                  },
///                  "upstream": {
///                    "anyOf": [
///                      {
///                        "type": "string"
///                      },
///                      {
///                        "type": "null"
///                      }
///                    ]
///                  }
///                },
///                "additionalProperties": false
///              }
///            },
///            "files": {
///              "type": "array",
///              "items": {
///                "type": "object",
///                "required": [
///                  "index",
///                  "kind",
///                  "path",
///                  "submodule",
///                  "worktree"
///                ],
///                "properties": {
///                  "index": {
///                    "type": "string",
///                    "maxLength": 1,
///                    "minLength": 1
///                  },
///                  "kind": {
///                    "type": "string",
///                    "enum": [
///                      "tracked",
///                      "untracked",
///                      "conflict"
///                    ]
///                  },
///                  "originalPath": {
///                    "anyOf": [
///                      {
///                        "type": "string",
///                        "maxLength": 4096,
///                        "minLength": 1
///                      },
///                      {
///                        "type": "null"
///                      }
///                    ]
///                  },
///                  "path": {
///                    "type": "string",
///                    "maxLength": 4096,
///                    "minLength": 1
///                  },
///                  "submodule": {
///                    "type": "boolean"
///                  },
///                  "worktree": {
///                    "type": "string",
///                    "maxLength": 1,
///                    "minLength": 1
///                  }
///                },
///                "additionalProperties": false
///              }
///            },
///            "gitWorkspaces": {
///              "default": [],
///              "type": "array",
///              "items": {
///                "type": "object",
///                "required": [
///                  "branch",
///                  "path"
///                ],
///                "properties": {
///                  "branch": {
///                    "anyOf": [
///                      {
///                        "type": "string"
///                      },
///                      {
///                        "type": "null"
///                      }
///                    ]
///                  },
///                  "path": {
///                    "type": "string"
///                  }
///                },
///                "additionalProperties": false
///              }
///            },
///            "head": {
///              "anyOf": [
///                {
///                  "type": "string"
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            },
///            "kind": {
///              "type": "string",
///              "const": "status"
///            },
///            "oid": {
///              "anyOf": [
///                {
///                  "type": "string"
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            },
///            "operation": {
///              "anyOf": [
///                {
///                  "type": "string",
///                  "enum": [
///                    "merge",
///                    "rebase",
///                    "cherry-pick",
///                    "revert",
///                    "bisect"
///                  ]
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            },
///            "remotes": {
///              "type": "array",
///              "items": {
///                "type": "string"
///              }
///            },
///            "repository": {
///              "type": "boolean"
///            },
///            "stashes": {
///              "default": 0,
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": 0.0
///            },
///            "upstream": {
///              "anyOf": [
///                {
///                  "type": "string"
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            }
///          },
///          "additionalProperties": false
///        },
///        "stderr": {
///          "type": "string"
///        },
///        "stdout": {
///          "type": "string"
///        },
///        "workspace": {
///          "type": "object",
///          "required": [
///            "branch",
///            "id",
///            "localPath",
///            "name",
///            "slug"
///          ],
///          "properties": {
///            "branch": {
///              "anyOf": [
///                {
///                  "type": "string"
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            },
///            "id": {
///              "type": "string",
///              "minLength": 1
///            },
///            "localPath": {
///              "type": "string",
///              "minLength": 1
///            },
///            "name": {
///              "type": "string",
///              "minLength": 1
///            },
///            "slug": {
///              "type": "string",
///              "minLength": 1
///            }
///          },
///          "additionalProperties": false
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "clean",
///        "kind",
///        "reasons"
///      ],
///      "properties": {
///        "clean": {
///          "type": "boolean"
///        },
///        "kind": {
///          "type": "string",
///          "const": "unpublished"
///        },
///        "reasons": {
///          "type": "array",
///          "items": {
///            "type": "string",
///            "maxLength": 512
///          },
///          "maxItems": 200
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "adopted",
///        "branch",
///        "kind",
///        "localPath"
///      ],
///      "properties": {
///        "adopted": {
///          "type": "boolean"
///        },
///        "branch": {
///          "anyOf": [
///            {
///              "type": "string"
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "kind": {
///          "type": "string",
///          "const": "prepared"
///        },
///        "localPath": {
///          "type": "string",
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "commits",
///        "head",
///        "kind",
///        "nextCursor",
///        "upstream"
///      ],
///      "properties": {
///        "commits": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "authorEmail",
///              "authorName",
///              "authoredAt",
///              "committedAt",
///              "oid",
///              "parents",
///              "refs",
///              "shortOid",
///              "subject"
///            ],
///            "properties": {
///              "authorEmail": {
///                "type": "string"
///              },
///              "authorName": {
///                "type": "string"
///              },
///              "authoredAt": {
///                "type": "string"
///              },
///              "committedAt": {
///                "type": "string"
///              },
///              "oid": {
///                "type": "string"
///              },
///              "parents": {
///                "type": "array",
///                "items": {
///                  "type": "string"
///                }
///              },
///              "refs": {
///                "type": "array",
///                "items": {
///                  "type": "string"
///                }
///              },
///              "shortOid": {
///                "type": "string"
///              },
///              "subject": {
///                "type": "string"
///              }
///            },
///            "additionalProperties": false
///          }
///        },
///        "head": {
///          "anyOf": [
///            {
///              "type": "string"
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "kind": {
///          "type": "string",
///          "const": "log"
///        },
///        "nextCursor": {
///          "anyOf": [
///            {
///              "type": "string"
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "upstream": {
///          "anyOf": [
///            {
///              "type": "string"
///            },
///            {
///              "type": "null"
///            }
///          ]
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "files",
///        "kind",
///        "message",
///        "oid"
///      ],
///      "properties": {
///        "files": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "additions",
///              "binary",
///              "deletions",
///              "path",
///              "status"
///            ],
///            "properties": {
///              "additions": {
///                "type": "integer",
///                "maximum": 9007199254740991.0,
///                "minimum": 0.0
///              },
///              "binary": {
///                "type": "boolean"
///              },
///              "deletions": {
///                "type": "integer",
///                "maximum": 9007199254740991.0,
///                "minimum": 0.0
///              },
///              "oldPath": {
///                "type": "string"
///              },
///              "path": {
///                "type": "string"
///              },
///              "status": {
///                "type": "string",
///                "enum": [
///                  "A",
///                  "M",
///                  "D",
///                  "R",
///                  "C",
///                  "T"
///                ]
///              }
///            },
///            "additionalProperties": false
///          }
///        },
///        "kind": {
///          "type": "string",
///          "const": "commit_detail"
///        },
///        "message": {
///          "type": "string"
///        },
///        "oid": {
///          "type": "string"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "binary",
///        "kind",
///        "oid",
///        "patch",
///        "path",
///        "truncated"
///      ],
///      "properties": {
///        "binary": {
///          "type": "boolean"
///        },
///        "kind": {
///          "type": "string",
///          "const": "commit_diff"
///        },
///        "oid": {
///          "type": "string"
///        },
///        "patch": {
///          "type": "string"
///        },
///        "path": {
///          "anyOf": [
///            {
///              "type": "string"
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "truncated": {
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "area",
///        "kind",
///        "patch",
///        "truncated",
///        "untrackedOmitted"
///      ],
///      "properties": {
///        "area": {
///          "type": "string",
///          "enum": [
///            "working",
///            "staged"
///          ]
///        },
///        "kind": {
///          "type": "string",
///          "const": "diff_all"
///        },
///        "patch": {
///          "type": "string"
///        },
///        "truncated": {
///          "type": "boolean"
///        },
///        "untrackedOmitted": {
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "base",
///        "files",
///        "head",
///        "kind",
///        "mergeBase",
///        "patch",
///        "truncated"
///      ],
///      "properties": {
///        "base": {
///          "type": "string"
///        },
///        "files": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "additions",
///              "binary",
///              "deletions",
///              "path",
///              "status"
///            ],
///            "properties": {
///              "additions": {
///                "type": "integer",
///                "maximum": 9007199254740991.0,
///                "minimum": 0.0
///              },
///              "binary": {
///                "type": "boolean"
///              },
///              "deletions": {
///                "type": "integer",
///                "maximum": 9007199254740991.0,
///                "minimum": 0.0
///              },
///              "oldPath": {
///                "type": "string"
///              },
///              "path": {
///                "type": "string"
///              },
///              "status": {
///                "type": "string",
///                "enum": [
///                  "A",
///                  "M",
///                  "D",
///                  "R",
///                  "C",
///                  "T"
///                ]
///              }
///            },
///            "additionalProperties": false
///          }
///        },
///        "head": {
///          "type": "string"
///        },
///        "kind": {
///          "type": "string",
///          "const": "range_diff"
///        },
///        "mergeBase": {
///          "type": "string"
///        },
///        "patch": {
///          "type": "string"
///        },
///        "truncated": {
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "branch",
///        "files",
///        "kind",
///        "patch",
///        "truncated"
///      ],
///      "properties": {
///        "branch": {
///          "anyOf": [
///            {
///              "type": "string"
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "files": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "additions",
///              "binary",
///              "deletions",
///              "path",
///              "status"
///            ],
///            "properties": {
///              "additions": {
///                "type": "integer",
///                "maximum": 9007199254740991.0,
///                "minimum": 0.0
///              },
///              "binary": {
///                "type": "boolean"
///              },
///              "deletions": {
///                "type": "integer",
///                "maximum": 9007199254740991.0,
///                "minimum": 0.0
///              },
///              "oldPath": {
///                "type": "string"
///              },
///              "path": {
///                "type": "string"
///              },
///              "status": {
///                "type": "string",
///                "enum": [
///                  "A",
///                  "M",
///                  "D",
///                  "R",
///                  "C",
///                  "T"
///                ]
///              }
///            },
///            "additionalProperties": false
///          }
///        },
///        "kind": {
///          "type": "string",
///          "const": "staged_context"
///        },
///        "patch": {
///          "type": "string"
///        },
///        "truncated": {
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "base",
///        "commits",
///        "files",
///        "head",
///        "kind",
///        "mergeBase",
///        "patch",
///        "truncated"
///      ],
///      "properties": {
///        "base": {
///          "type": "string"
///        },
///        "commits": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "author",
///              "body",
///              "oid",
///              "subject"
///            ],
///            "properties": {
///              "author": {
///                "type": "string"
///              },
///              "body": {
///                "type": "string"
///              },
///              "oid": {
///                "type": "string"
///              },
///              "subject": {
///                "type": "string"
///              }
///            },
///            "additionalProperties": false
///          },
///          "maxItems": 40
///        },
///        "files": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "additions",
///              "binary",
///              "deletions",
///              "path",
///              "status"
///            ],
///            "properties": {
///              "additions": {
///                "type": "integer",
///                "maximum": 9007199254740991.0,
///                "minimum": 0.0
///              },
///              "binary": {
///                "type": "boolean"
///              },
///              "deletions": {
///                "type": "integer",
///                "maximum": 9007199254740991.0,
///                "minimum": 0.0
///              },
///              "oldPath": {
///                "type": "string"
///              },
///              "path": {
///                "type": "string"
///              },
///              "status": {
///                "type": "string",
///                "enum": [
///                  "A",
///                  "M",
///                  "D",
///                  "R",
///                  "C",
///                  "T"
///                ]
///              }
///            },
///            "additionalProperties": false
///          }
///        },
///        "head": {
///          "type": "string"
///        },
///        "kind": {
///          "type": "string",
///          "const": "range_context"
///        },
///        "mergeBase": {
///          "type": "string"
///        },
///        "patch": {
///          "type": "string"
///        },
///        "truncated": {
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "entries",
///        "kind"
///      ],
///      "properties": {
///        "entries": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "createdAt",
///              "index",
///              "message"
///            ],
///            "properties": {
///              "createdAt": {
///                "type": "string"
///              },
///              "index": {
///                "type": "integer",
///                "maximum": 9007199254740991.0,
///                "minimum": 0.0
///              },
///              "message": {
///                "type": "string"
///              }
///            },
///            "additionalProperties": false
///          }
///        },
///        "kind": {
///          "type": "string",
///          "const": "stash_list"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "entries",
///        "kind",
///        "path",
///        "truncated"
///      ],
///      "properties": {
///        "entries": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "ignored",
///              "name",
///              "path",
///              "type"
///            ],
///            "properties": {
///              "ignored": {
///                "type": "boolean"
///              },
///              "name": {
///                "type": "string"
///              },
///              "path": {
///                "type": "string"
///              },
///              "size": {
///                "type": "integer",
///                "maximum": 9007199254740991.0,
///                "minimum": 0.0
///              },
///              "type": {
///                "type": "string",
///                "enum": [
///                  "file",
///                  "directory",
///                  "symlink"
///                ]
///              }
///            },
///            "additionalProperties": false
///          }
///        },
///        "kind": {
///          "type": "string",
///          "const": "tree"
///        },
///        "path": {
///          "type": "string"
///        },
///        "truncated": {
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "binary",
///        "content",
///        "encoding",
///        "kind",
///        "mime",
///        "path",
///        "size",
///        "token",
///        "truncated"
///      ],
///      "properties": {
///        "binary": {
///          "type": "boolean"
///        },
///        "content": {
///          "type": "string"
///        },
///        "encoding": {
///          "type": "string",
///          "enum": [
///            "text",
///            "base64"
///          ]
///        },
///        "kind": {
///          "type": "string",
///          "const": "file"
///        },
///        "mime": {
///          "anyOf": [
///            {
///              "type": "string"
///            },
///            {
///              "type": "null"
///            }
///          ]
///        },
///        "path": {
///          "type": "string"
///        },
///        "size": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": 0.0
///        },
///        "token": {
///          "type": "string"
///        },
///        "truncated": {
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "kind",
///        "path",
///        "status",
///        "token"
///      ],
///      "properties": {
///        "kind": {
///          "type": "string",
///          "const": "file_write"
///        },
///        "path": {
///          "type": "string"
///        },
///        "status": {
///          "type": "string",
///          "enum": [
///            "written",
///            "conflict"
///          ]
///        },
///        "token": {
///          "type": "string"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "files",
///        "filesSearched",
///        "filesSkipped",
///        "kind",
///        "totalMatches",
///        "truncated"
///      ],
///      "properties": {
///        "files": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "matches",
///              "path",
///              "token",
///              "truncated"
///            ],
///            "properties": {
///              "matches": {
///                "type": "array",
///                "items": {
///                  "type": "object",
///                  "required": [
///                    "column",
///                    "length",
///                    "line",
///                    "preview",
///                    "previewOffset"
///                  ],
///                  "properties": {
///                    "column": {
///                      "type": "integer",
///                      "maximum": 9007199254740991.0,
///                      "minimum": 1.0
///                    },
///                    "length": {
///                      "type": "integer",
///                      "maximum": 9007199254740991.0,
///                      "minimum": 0.0
///                    },
///                    "line": {
///                      "type": "integer",
///                      "maximum": 9007199254740991.0,
///                      "minimum": 1.0
///                    },
///                    "preview": {
///                      "type": "string"
///                    },
///                    "previewOffset": {
///                      "type": "integer",
///                      "maximum": 9007199254740991.0,
///                      "minimum": 0.0
///                    }
///                  },
///                  "additionalProperties": false
///                }
///              },
///              "path": {
///                "type": "string"
///              },
///              "token": {
///                "type": "string"
///              },
///              "truncated": {
///                "type": "boolean"
///              }
///            },
///            "additionalProperties": false
///          }
///        },
///        "filesSearched": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": 0.0
///        },
///        "filesSkipped": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": 0.0
///        },
///        "kind": {
///          "type": "string",
///          "const": "search"
///        },
///        "totalMatches": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": 0.0
///        },
///        "truncated": {
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "files",
///        "kind",
///        "replaced",
///        "skipped"
///      ],
///      "properties": {
///        "files": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "path",
///              "replaced",
///              "status"
///            ],
///            "properties": {
///              "path": {
///                "type": "string"
///              },
///              "replaced": {
///                "type": "integer",
///                "maximum": 9007199254740991.0,
///                "minimum": 0.0
///              },
///              "status": {
///                "type": "string",
///                "enum": [
///                  "ok",
///                  "conflict",
///                  "missing",
///                  "skipped"
///                ]
///              }
///            },
///            "additionalProperties": false
///          }
///        },
///        "kind": {
///          "type": "string",
///          "const": "replace"
///        },
///        "replaced": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": 0.0
///        },
///        "skipped": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": 0.0
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "kind",
///        "state"
///      ],
///      "properties": {
///        "account": {
///          "type": "object",
///          "required": [
///            "email",
///            "label",
///            "newRegistration",
///            "planUsage",
///            "scopes"
///          ],
///          "properties": {
///            "email": {
///              "anyOf": [
///                {
///                  "type": "string",
///                  "maxLength": 320,
///                  "minLength": 1
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            },
///            "label": {
///              "type": "string",
///              "maxLength": 256,
///              "minLength": 1
///            },
///            "newRegistration": {
///              "type": "boolean"
///            },
///            "planUsage": {
///              "type": "boolean"
///            },
///            "scopes": {
///              "type": "array",
///              "items": {
///                "type": "string",
///                "maxLength": 128,
///                "minLength": 1
///              },
///              "maxItems": 16
///            }
///          },
///          "additionalProperties": false
///        },
///        "kind": {
///          "type": "string",
///          "const": "chatgpt_status"
///        },
///        "loginError": {
///          "type": "string",
///          "enum": [
///            "login_timeout",
///            "state_mismatch",
///            "plan_disabled",
///            "missing_code",
///            "registration_incomplete",
///            "client_mismatch",
///            "temporarily_unavailable",
///            "invalid_token_response",
///            "invalid_id_token",
///            "subject_mismatch",
///            "reconnect",
///            "client_invalid",
///            "cancelled"
///          ]
///        },
///        "pending": {
///          "type": "object",
///          "required": [
///            "expiresAt"
///          ],
///          "properties": {
///            "expiresAt": {
///              "type": "integer",
///              "maximum": 9007199254740991.0,
///              "minimum": 0.0
///            }
///          },
///          "additionalProperties": false
///        },
///        "state": {
///          "type": "string",
///          "enum": [
///            "signed_out",
///            "pending",
///            "ready",
///            "plan_disabled",
///            "reconnect",
///            "client_invalid",
///            "unavailable_on_cloud"
///          ]
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "authorizeUrl",
///        "expiresAt",
///        "kind"
///      ],
///      "properties": {
///        "authorizeUrl": {
///          "type": "string",
///          "format": "uri",
///          "maxLength": 4096
///        },
///        "expiresAt": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": 0.0
///        },
///        "kind": {
///          "type": "string",
///          "const": "chatgpt_login"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "kind",
///        "revocationConfirmed"
///      ],
///      "properties": {
///        "kind": {
///          "type": "string",
///          "const": "chatgpt_logout"
///        },
///        "revocationConfirmed": {
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "kind",
///        "models"
///      ],
///      "properties": {
///        "kind": {
///          "type": "string",
///          "const": "chatgpt_models"
///        },
///        "models": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "id",
///              "label"
///            ],
///            "properties": {
///              "id": {
///                "type": "string",
///                "maxLength": 128,
///                "minLength": 1,
///                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$"
///              },
///              "label": {
///                "type": "string",
///                "maxLength": 256,
///                "minLength": 1
///              }
///            },
///            "additionalProperties": false
///          },
///          "maxItems": 50
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "oneOf": [
///        {
///          "type": "object",
///          "required": [
///            "kind",
///            "model",
///            "outcome",
///            "text"
///          ],
///          "properties": {
///            "kind": {
///              "type": "string",
///              "const": "chatgpt_generation"
///            },
///            "model": {
///              "type": "string",
///              "maxLength": 128,
///              "minLength": 1,
///              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$"
///            },
///            "outcome": {
///              "type": "string",
///              "const": "completed"
///            },
///            "text": {
///              "type": "string",
///              "maxLength": 200000
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "object",
///          "required": [
///            "kind",
///            "outcome",
///            "reason"
///          ],
///          "properties": {
///            "code": {
///              "type": "string",
///              "maxLength": 128,
///              "minLength": 1
///            },
///            "httpStatus": {
///              "type": "integer",
///              "maximum": 599.0,
///              "minimum": 100.0
///            },
///            "kind": {
///              "type": "string",
///              "const": "chatgpt_generation"
///            },
///            "outcome": {
///              "type": "string",
///              "const": "failed"
///            },
///            "param": {
///              "type": "string",
///              "maxLength": 128,
///              "minLength": 1
///            },
///            "reason": {
///              "type": "string",
///              "enum": [
///                "usage_limit",
///                "not_eligible",
///                "plan_disabled",
///                "reconnect",
///                "unsupported",
///                "route_not_supported",
///                "permission",
///                "region_or_policy",
///                "temporarily_unavailable",
///                "incomplete",
///                "interrupted",
///                "model_unavailable",
///                "signed_out",
///                "failed"
///              ]
///            },
///            "requestId": {
///              "type": "string",
///              "maxLength": 128,
///              "minLength": 1
///            }
///          },
///          "additionalProperties": false
///        }
///      ]
///    }
///  ]
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(untagged, deny_unknown_fields)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0Value {
    Variant0 {
        ahead: i64,
        behind: i64,
        branches: ::std::vec::Vec<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0BranchesItem,
        >,
        files:
            ::std::vec::Vec<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItem>,
        #[serde(rename = "gitWorkspaces")]
        git_workspaces: ::std::vec::Vec<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0GitWorkspacesItem,
        >,
        head: ::std::option::Option<::std::string::String>,
        kind: ::std::string::String,
        oid: ::std::option::Option<::std::string::String>,
        operation: ::std::option::Option<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0Operation,
        >,
        remotes: ::std::vec::Vec<::std::string::String>,
        repository: bool,
        stashes: i64,
        upstream: ::std::option::Option<::std::string::String>,
    },
    Variant1 {
        area: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Area,
        binary: bool,
        kind: ::std::string::String,
        patch: ::std::string::String,
        path: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Path,
        truncated: bool,
    },
    Variant2 {
        kind: ::std::string::String,
        status: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2Status,
        stderr: ::std::string::String,
        stdout: ::std::string::String,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        workspace: ::std::option::Option<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2Workspace,
        >,
    },
    Variant3 {
        clean: bool,
        kind: ::std::string::String,
        reasons: ::std::vec::Vec<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant3ReasonsItem,
        >,
    },
    Variant4 {
        adopted: bool,
        branch: ::std::option::Option<::std::string::String>,
        kind: ::std::string::String,
        #[serde(rename = "localPath")]
        local_path: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant4LocalPath,
    },
    Variant5 {
        commits: ::std::vec::Vec<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant5CommitsItem,
        >,
        head: ::std::option::Option<::std::string::String>,
        kind: ::std::string::String,
        #[serde(rename = "nextCursor")]
        next_cursor: ::std::option::Option<::std::string::String>,
        upstream: ::std::option::Option<::std::string::String>,
    },
    Variant6 {
        files:
            ::std::vec::Vec<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant6FilesItem>,
        kind: ::std::string::String,
        message: ::std::string::String,
        oid: ::std::string::String,
    },
    Variant7 {
        binary: bool,
        kind: ::std::string::String,
        oid: ::std::string::String,
        patch: ::std::string::String,
        path: ::std::option::Option<::std::string::String>,
        truncated: bool,
    },
    Variant8 {
        area: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant8Area,
        kind: ::std::string::String,
        patch: ::std::string::String,
        truncated: bool,
        #[serde(rename = "untrackedOmitted")]
        untracked_omitted: bool,
    },
    Variant9 {
        base: ::std::string::String,
        files:
            ::std::vec::Vec<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant9FilesItem>,
        head: ::std::string::String,
        kind: ::std::string::String,
        #[serde(rename = "mergeBase")]
        merge_base: ::std::string::String,
        patch: ::std::string::String,
        truncated: bool,
    },
    Variant10 {
        branch: ::std::option::Option<::std::string::String>,
        files: ::std::vec::Vec<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant10FilesItem,
        >,
        kind: ::std::string::String,
        patch: ::std::string::String,
        truncated: bool,
    },
    Variant11 {
        base: ::std::string::String,
        commits: ::std::vec::Vec<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant11CommitsItem,
        >,
        files: ::std::vec::Vec<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant11FilesItem,
        >,
        head: ::std::string::String,
        kind: ::std::string::String,
        #[serde(rename = "mergeBase")]
        merge_base: ::std::string::String,
        patch: ::std::string::String,
        truncated: bool,
    },
    Variant12 {
        entries: ::std::vec::Vec<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant12EntriesItem,
        >,
        kind: ::std::string::String,
    },
    Variant13 {
        entries: ::std::vec::Vec<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant13EntriesItem,
        >,
        kind: ::std::string::String,
        path: ::std::string::String,
        truncated: bool,
    },
    Variant14 {
        binary: bool,
        content: ::std::string::String,
        encoding: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant14Encoding,
        kind: ::std::string::String,
        mime: ::std::option::Option<::std::string::String>,
        path: ::std::string::String,
        size: i64,
        token: ::std::string::String,
        truncated: bool,
    },
    Variant15 {
        kind: ::std::string::String,
        path: ::std::string::String,
        status: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant15Status,
        token: ::std::string::String,
    },
    Variant16 {
        files: ::std::vec::Vec<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant16FilesItem,
        >,
        #[serde(rename = "filesSearched")]
        files_searched: i64,
        #[serde(rename = "filesSkipped")]
        files_skipped: i64,
        kind: ::std::string::String,
        #[serde(rename = "totalMatches")]
        total_matches: i64,
        truncated: bool,
    },
    Variant17 {
        files: ::std::vec::Vec<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant17FilesItem,
        >,
        kind: ::std::string::String,
        replaced: i64,
        skipped: i64,
    },
    Variant18 {
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        account: ::std::option::Option<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18Account,
        >,
        kind: ::std::string::String,
        #[serde(
            rename = "loginError",
            default,
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        login_error: ::std::option::Option<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18LoginError,
        >,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        pending: ::std::option::Option<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18Pending,
        >,
        state: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18State,
    },
    Variant19 {
        #[serde(rename = "authorizeUrl")]
        authorize_url: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant19AuthorizeUrl,
        #[serde(rename = "expiresAt")]
        expires_at: i64,
        kind: ::std::string::String,
    },
    Variant20 {
        kind: ::std::string::String,
        #[serde(rename = "revocationConfirmed")]
        revocation_confirmed: bool,
    },
    Variant21 {
        kind: ::std::string::String,
        models: ::std::vec::Vec<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItem,
        >,
    },
    Variant22(ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22),
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22>
    for ExeoraProtocolTypesExecutorMessageResultVariant0Value
{
    fn from(value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22) -> Self {
        Self::Variant22(value)
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0BranchesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "ahead",
///    "current",
///    "name",
///    "remote",
///    "shortOid",
///    "upstream"
///  ],
///  "properties": {
///    "ahead": {
///      "default": null,
///      "anyOf": [
///        {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": 0.0
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "current": {
///      "type": "boolean"
///    },
///    "name": {
///      "type": "string"
///    },
///    "remote": {
///      "type": "boolean"
///    },
///    "shortOid": {
///      "type": "string"
///    },
///    "upstream": {
///      "anyOf": [
///        {
///          "type": "string"
///        },
///        {
///          "type": "null"
///        }
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0BranchesItem {
    pub ahead: ::std::option::Option<i64>,
    pub current: bool,
    pub name: ::std::string::String,
    pub remote: bool,
    #[serde(rename = "shortOid")]
    pub short_oid: ::std::string::String,
    pub upstream: ::std::option::Option<::std::string::String>,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "index",
///    "kind",
///    "path",
///    "submodule",
///    "worktree"
///  ],
///  "properties": {
///    "index": {
///      "type": "string",
///      "maxLength": 1,
///      "minLength": 1
///    },
///    "kind": {
///      "type": "string",
///      "enum": [
///        "tracked",
///        "untracked",
///        "conflict"
///      ]
///    },
///    "originalPath": {
///      "anyOf": [
///        {
///          "type": "string",
///          "maxLength": 4096,
///          "minLength": 1
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "path": {
///      "type": "string",
///      "maxLength": 4096,
///      "minLength": 1
///    },
///    "submodule": {
///      "type": "boolean"
///    },
///    "worktree": {
///      "type": "string",
///      "maxLength": 1,
///      "minLength": 1
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItem {
    pub index: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemIndex,
    pub kind: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemKind,
    #[serde(
        rename = "originalPath",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub original_path: ::std::option::Option<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemOriginalPath,
    >,
    pub path: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemPath,
    pub submodule: bool,
    pub worktree: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemWorktree,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemIndex`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 1,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemIndex(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemIndex
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemIndex,
    > for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemIndex,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemIndex
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 1usize {
            return Err("longer than 1 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemIndex
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemIndex
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemIndex
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemIndex
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemKind`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "tracked",
///    "untracked",
///    "conflict"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemKind {
    #[serde(rename = "tracked")]
    Tracked,
    #[serde(rename = "untracked")]
    Untracked,
    #[serde(rename = "conflict")]
    Conflict,
}
impl ::std::fmt::Display
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemKind
{
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Tracked => f.write_str("tracked"),
            Self::Untracked => f.write_str("untracked"),
            Self::Conflict => f.write_str("conflict"),
        }
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemKind
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "tracked" => Ok(Self::Tracked),
            "untracked" => Ok(Self::Untracked),
            "conflict" => Ok(Self::Conflict),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemKind
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemKind
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemKind
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemOriginalPath`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 4096,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemOriginalPath(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemOriginalPath
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemOriginalPath,
    > for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemOriginalPath,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemOriginalPath
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 4096usize {
            return Err("longer than 4096 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemOriginalPath
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemOriginalPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemOriginalPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemOriginalPath
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemPath`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 4096,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemPath(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemPath
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemPath>
    for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemPath,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemPath
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 4096usize {
            return Err("longer than 4096 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemPath
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemPath
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemWorktree`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 1,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemWorktree(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemWorktree
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemWorktree,
    > for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemWorktree,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemWorktree
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 1usize {
            return Err("longer than 1 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemWorktree
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemWorktree
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemWorktree
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0FilesItemWorktree
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0GitWorkspacesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "branch",
///    "path"
///  ],
///  "properties": {
///    "branch": {
///      "anyOf": [
///        {
///          "type": "string"
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "path": {
///      "type": "string"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0GitWorkspacesItem {
    pub branch: ::std::option::Option<::std::string::String>,
    pub path: ::std::string::String,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0Operation`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "merge",
///    "rebase",
///    "cherry-pick",
///    "revert",
///    "bisect"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0Operation {
    #[serde(rename = "merge")]
    Merge,
    #[serde(rename = "rebase")]
    Rebase,
    #[serde(rename = "cherry-pick")]
    CherryPick,
    #[serde(rename = "revert")]
    Revert,
    #[serde(rename = "bisect")]
    Bisect,
}
impl ::std::fmt::Display
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0Operation
{
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Merge => f.write_str("merge"),
            Self::Rebase => f.write_str("rebase"),
            Self::CherryPick => f.write_str("cherry-pick"),
            Self::Revert => f.write_str("revert"),
            Self::Bisect => f.write_str("bisect"),
        }
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0Operation
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "merge" => Ok(Self::Merge),
            "rebase" => Ok(Self::Rebase),
            "cherry-pick" => Ok(Self::CherryPick),
            "revert" => Ok(Self::Revert),
            "bisect" => Ok(Self::Bisect),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0Operation
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0Operation
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant0Operation
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant10FilesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "additions",
///    "binary",
///    "deletions",
///    "path",
///    "status"
///  ],
///  "properties": {
///    "additions": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 0.0
///    },
///    "binary": {
///      "type": "boolean"
///    },
///    "deletions": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 0.0
///    },
///    "oldPath": {
///      "type": "string"
///    },
///    "path": {
///      "type": "string"
///    },
///    "status": {
///      "type": "string",
///      "enum": [
///        "A",
///        "M",
///        "D",
///        "R",
///        "C",
///        "T"
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant10FilesItem {
    pub additions: i64,
    pub binary: bool,
    pub deletions: i64,
    #[serde(
        rename = "oldPath",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub old_path: ::std::option::Option<::std::string::String>,
    pub path: ::std::string::String,
    pub status: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant10FilesItemStatus,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant10FilesItemStatus`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "A",
///    "M",
///    "D",
///    "R",
///    "C",
///    "T"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant10FilesItemStatus {
    A,
    M,
    D,
    R,
    C,
    T,
}
impl ::std::fmt::Display
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant10FilesItemStatus
{
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::A => f.write_str("A"),
            Self::M => f.write_str("M"),
            Self::D => f.write_str("D"),
            Self::R => f.write_str("R"),
            Self::C => f.write_str("C"),
            Self::T => f.write_str("T"),
        }
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant10FilesItemStatus
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "A" => Ok(Self::A),
            "M" => Ok(Self::M),
            "D" => Ok(Self::D),
            "R" => Ok(Self::R),
            "C" => Ok(Self::C),
            "T" => Ok(Self::T),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant10FilesItemStatus
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant10FilesItemStatus
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant10FilesItemStatus
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant11CommitsItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "author",
///    "body",
///    "oid",
///    "subject"
///  ],
///  "properties": {
///    "author": {
///      "type": "string"
///    },
///    "body": {
///      "type": "string"
///    },
///    "oid": {
///      "type": "string"
///    },
///    "subject": {
///      "type": "string"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant11CommitsItem {
    pub author: ::std::string::String,
    pub body: ::std::string::String,
    pub oid: ::std::string::String,
    pub subject: ::std::string::String,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant11FilesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "additions",
///    "binary",
///    "deletions",
///    "path",
///    "status"
///  ],
///  "properties": {
///    "additions": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 0.0
///    },
///    "binary": {
///      "type": "boolean"
///    },
///    "deletions": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 0.0
///    },
///    "oldPath": {
///      "type": "string"
///    },
///    "path": {
///      "type": "string"
///    },
///    "status": {
///      "type": "string",
///      "enum": [
///        "A",
///        "M",
///        "D",
///        "R",
///        "C",
///        "T"
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant11FilesItem {
    pub additions: i64,
    pub binary: bool,
    pub deletions: i64,
    #[serde(
        rename = "oldPath",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub old_path: ::std::option::Option<::std::string::String>,
    pub path: ::std::string::String,
    pub status: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant11FilesItemStatus,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant11FilesItemStatus`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "A",
///    "M",
///    "D",
///    "R",
///    "C",
///    "T"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant11FilesItemStatus {
    A,
    M,
    D,
    R,
    C,
    T,
}
impl ::std::fmt::Display
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant11FilesItemStatus
{
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::A => f.write_str("A"),
            Self::M => f.write_str("M"),
            Self::D => f.write_str("D"),
            Self::R => f.write_str("R"),
            Self::C => f.write_str("C"),
            Self::T => f.write_str("T"),
        }
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant11FilesItemStatus
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "A" => Ok(Self::A),
            "M" => Ok(Self::M),
            "D" => Ok(Self::D),
            "R" => Ok(Self::R),
            "C" => Ok(Self::C),
            "T" => Ok(Self::T),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant11FilesItemStatus
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant11FilesItemStatus
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant11FilesItemStatus
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant12EntriesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "createdAt",
///    "index",
///    "message"
///  ],
///  "properties": {
///    "createdAt": {
///      "type": "string"
///    },
///    "index": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 0.0
///    },
///    "message": {
///      "type": "string"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant12EntriesItem {
    #[serde(rename = "createdAt")]
    pub created_at: ::std::string::String,
    pub index: i64,
    pub message: ::std::string::String,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant13EntriesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "ignored",
///    "name",
///    "path",
///    "type"
///  ],
///  "properties": {
///    "ignored": {
///      "type": "boolean"
///    },
///    "name": {
///      "type": "string"
///    },
///    "path": {
///      "type": "string"
///    },
///    "size": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 0.0
///    },
///    "type": {
///      "type": "string",
///      "enum": [
///        "file",
///        "directory",
///        "symlink"
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant13EntriesItem {
    pub ignored: bool,
    pub name: ::std::string::String,
    pub path: ::std::string::String,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub size: ::std::option::Option<i64>,
    #[serde(rename = "type")]
    pub type_: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant13EntriesItemType,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant13EntriesItemType`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "file",
///    "directory",
///    "symlink"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant13EntriesItemType {
    #[serde(rename = "file")]
    File,
    #[serde(rename = "directory")]
    Directory,
    #[serde(rename = "symlink")]
    Symlink,
}
impl ::std::fmt::Display
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant13EntriesItemType
{
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::File => f.write_str("file"),
            Self::Directory => f.write_str("directory"),
            Self::Symlink => f.write_str("symlink"),
        }
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant13EntriesItemType
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "file" => Ok(Self::File),
            "directory" => Ok(Self::Directory),
            "symlink" => Ok(Self::Symlink),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant13EntriesItemType
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant13EntriesItemType
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant13EntriesItemType
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant14Encoding`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "text",
///    "base64"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant14Encoding {
    #[serde(rename = "text")]
    Text,
    #[serde(rename = "base64")]
    Base64,
}
impl ::std::fmt::Display
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant14Encoding
{
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Text => f.write_str("text"),
            Self::Base64 => f.write_str("base64"),
        }
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant14Encoding
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "text" => Ok(Self::Text),
            "base64" => Ok(Self::Base64),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant14Encoding
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant14Encoding
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant14Encoding
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant15Status`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "written",
///    "conflict"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant15Status {
    #[serde(rename = "written")]
    Written,
    #[serde(rename = "conflict")]
    Conflict,
}
impl ::std::fmt::Display for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant15Status {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Written => f.write_str("written"),
            Self::Conflict => f.write_str("conflict"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant15Status {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "written" => Ok(Self::Written),
            "conflict" => Ok(Self::Conflict),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant15Status
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant15Status
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant15Status
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant16FilesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "matches",
///    "path",
///    "token",
///    "truncated"
///  ],
///  "properties": {
///    "matches": {
///      "type": "array",
///      "items": {
///        "type": "object",
///        "required": [
///          "column",
///          "length",
///          "line",
///          "preview",
///          "previewOffset"
///        ],
///        "properties": {
///          "column": {
///            "type": "integer",
///            "maximum": 9007199254740991.0,
///            "minimum": 1.0
///          },
///          "length": {
///            "type": "integer",
///            "maximum": 9007199254740991.0,
///            "minimum": 0.0
///          },
///          "line": {
///            "type": "integer",
///            "maximum": 9007199254740991.0,
///            "minimum": 1.0
///          },
///          "preview": {
///            "type": "string"
///          },
///          "previewOffset": {
///            "type": "integer",
///            "maximum": 9007199254740991.0,
///            "minimum": 0.0
///          }
///        },
///        "additionalProperties": false
///      }
///    },
///    "path": {
///      "type": "string"
///    },
///    "token": {
///      "type": "string"
///    },
///    "truncated": {
///      "type": "boolean"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant16FilesItem {
    pub matches: ::std::vec::Vec<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant16FilesItemMatchesItem,
    >,
    pub path: ::std::string::String,
    pub token: ::std::string::String,
    pub truncated: bool,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant16FilesItemMatchesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "column",
///    "length",
///    "line",
///    "preview",
///    "previewOffset"
///  ],
///  "properties": {
///    "column": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 1.0
///    },
///    "length": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 0.0
///    },
///    "line": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 1.0
///    },
///    "preview": {
///      "type": "string"
///    },
///    "previewOffset": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 0.0
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant16FilesItemMatchesItem {
    pub column: ::std::num::NonZeroU64,
    pub length: i64,
    pub line: ::std::num::NonZeroU64,
    pub preview: ::std::string::String,
    #[serde(rename = "previewOffset")]
    pub preview_offset: i64,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant17FilesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "path",
///    "replaced",
///    "status"
///  ],
///  "properties": {
///    "path": {
///      "type": "string"
///    },
///    "replaced": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 0.0
///    },
///    "status": {
///      "type": "string",
///      "enum": [
///        "ok",
///        "conflict",
///        "missing",
///        "skipped"
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant17FilesItem {
    pub path: ::std::string::String,
    pub replaced: i64,
    pub status: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant17FilesItemStatus,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant17FilesItemStatus`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "ok",
///    "conflict",
///    "missing",
///    "skipped"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant17FilesItemStatus {
    #[serde(rename = "ok")]
    Ok,
    #[serde(rename = "conflict")]
    Conflict,
    #[serde(rename = "missing")]
    Missing,
    #[serde(rename = "skipped")]
    Skipped,
}
impl ::std::fmt::Display
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant17FilesItemStatus
{
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Ok => f.write_str("ok"),
            Self::Conflict => f.write_str("conflict"),
            Self::Missing => f.write_str("missing"),
            Self::Skipped => f.write_str("skipped"),
        }
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant17FilesItemStatus
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "ok" => Ok(Self::Ok),
            "conflict" => Ok(Self::Conflict),
            "missing" => Ok(Self::Missing),
            "skipped" => Ok(Self::Skipped),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant17FilesItemStatus
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant17FilesItemStatus
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant17FilesItemStatus
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18Account`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "email",
///    "label",
///    "newRegistration",
///    "planUsage",
///    "scopes"
///  ],
///  "properties": {
///    "email": {
///      "anyOf": [
///        {
///          "type": "string",
///          "maxLength": 320,
///          "minLength": 1
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "label": {
///      "type": "string",
///      "maxLength": 256,
///      "minLength": 1
///    },
///    "newRegistration": {
///      "type": "boolean"
///    },
///    "planUsage": {
///      "type": "boolean"
///    },
///    "scopes": {
///      "type": "array",
///      "items": {
///        "type": "string",
///        "maxLength": 128,
///        "minLength": 1
///      },
///      "maxItems": 16
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18Account {
    pub email: ::std::option::Option<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountEmail,
    >,
    pub label: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountLabel,
    #[serde(rename = "newRegistration")]
    pub new_registration: bool,
    #[serde(rename = "planUsage")]
    pub plan_usage: bool,
    pub scopes: ::std::vec::Vec<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountScopesItem,
    >,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountEmail`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 320,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountEmail(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountEmail
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountEmail>
    for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountEmail,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountEmail
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 320usize {
            return Err("longer than 320 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountEmail
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountEmail
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountEmail
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountEmail
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountLabel`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 256,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountLabel(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountLabel
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountLabel>
    for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountLabel,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountLabel
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 256usize {
            return Err("longer than 256 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountLabel
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountLabel
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountLabel
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountLabel
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountScopesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 128,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountScopesItem(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountScopesItem
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountScopesItem,
    > for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountScopesItem,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountScopesItem
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 128usize {
            return Err("longer than 128 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountScopesItem
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountScopesItem
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountScopesItem
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18AccountScopesItem
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18LoginError`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "login_timeout",
///    "state_mismatch",
///    "plan_disabled",
///    "missing_code",
///    "registration_incomplete",
///    "client_mismatch",
///    "temporarily_unavailable",
///    "invalid_token_response",
///    "invalid_id_token",
///    "subject_mismatch",
///    "reconnect",
///    "client_invalid",
///    "cancelled"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18LoginError {
    #[serde(rename = "login_timeout")]
    LoginTimeout,
    #[serde(rename = "state_mismatch")]
    StateMismatch,
    #[serde(rename = "plan_disabled")]
    PlanDisabled,
    #[serde(rename = "missing_code")]
    MissingCode,
    #[serde(rename = "registration_incomplete")]
    RegistrationIncomplete,
    #[serde(rename = "client_mismatch")]
    ClientMismatch,
    #[serde(rename = "temporarily_unavailable")]
    TemporarilyUnavailable,
    #[serde(rename = "invalid_token_response")]
    InvalidTokenResponse,
    #[serde(rename = "invalid_id_token")]
    InvalidIdToken,
    #[serde(rename = "subject_mismatch")]
    SubjectMismatch,
    #[serde(rename = "reconnect")]
    Reconnect,
    #[serde(rename = "client_invalid")]
    ClientInvalid,
    #[serde(rename = "cancelled")]
    Cancelled,
}
impl ::std::fmt::Display
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18LoginError
{
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::LoginTimeout => f.write_str("login_timeout"),
            Self::StateMismatch => f.write_str("state_mismatch"),
            Self::PlanDisabled => f.write_str("plan_disabled"),
            Self::MissingCode => f.write_str("missing_code"),
            Self::RegistrationIncomplete => f.write_str("registration_incomplete"),
            Self::ClientMismatch => f.write_str("client_mismatch"),
            Self::TemporarilyUnavailable => f.write_str("temporarily_unavailable"),
            Self::InvalidTokenResponse => f.write_str("invalid_token_response"),
            Self::InvalidIdToken => f.write_str("invalid_id_token"),
            Self::SubjectMismatch => f.write_str("subject_mismatch"),
            Self::Reconnect => f.write_str("reconnect"),
            Self::ClientInvalid => f.write_str("client_invalid"),
            Self::Cancelled => f.write_str("cancelled"),
        }
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18LoginError
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "login_timeout" => Ok(Self::LoginTimeout),
            "state_mismatch" => Ok(Self::StateMismatch),
            "plan_disabled" => Ok(Self::PlanDisabled),
            "missing_code" => Ok(Self::MissingCode),
            "registration_incomplete" => Ok(Self::RegistrationIncomplete),
            "client_mismatch" => Ok(Self::ClientMismatch),
            "temporarily_unavailable" => Ok(Self::TemporarilyUnavailable),
            "invalid_token_response" => Ok(Self::InvalidTokenResponse),
            "invalid_id_token" => Ok(Self::InvalidIdToken),
            "subject_mismatch" => Ok(Self::SubjectMismatch),
            "reconnect" => Ok(Self::Reconnect),
            "client_invalid" => Ok(Self::ClientInvalid),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18LoginError
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18LoginError
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18LoginError
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18Pending`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "expiresAt"
///  ],
///  "properties": {
///    "expiresAt": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 0.0
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18Pending {
    #[serde(rename = "expiresAt")]
    pub expires_at: i64,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18State`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "signed_out",
///    "pending",
///    "ready",
///    "plan_disabled",
///    "reconnect",
///    "client_invalid",
///    "unavailable_on_cloud"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18State {
    #[serde(rename = "signed_out")]
    SignedOut,
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "plan_disabled")]
    PlanDisabled,
    #[serde(rename = "reconnect")]
    Reconnect,
    #[serde(rename = "client_invalid")]
    ClientInvalid,
    #[serde(rename = "unavailable_on_cloud")]
    UnavailableOnCloud,
}
impl ::std::fmt::Display for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18State {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::SignedOut => f.write_str("signed_out"),
            Self::Pending => f.write_str("pending"),
            Self::Ready => f.write_str("ready"),
            Self::PlanDisabled => f.write_str("plan_disabled"),
            Self::Reconnect => f.write_str("reconnect"),
            Self::ClientInvalid => f.write_str("client_invalid"),
            Self::UnavailableOnCloud => f.write_str("unavailable_on_cloud"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18State {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "signed_out" => Ok(Self::SignedOut),
            "pending" => Ok(Self::Pending),
            "ready" => Ok(Self::Ready),
            "plan_disabled" => Ok(Self::PlanDisabled),
            "reconnect" => Ok(Self::Reconnect),
            "client_invalid" => Ok(Self::ClientInvalid),
            "unavailable_on_cloud" => Ok(Self::UnavailableOnCloud),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18State
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18State
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant18State
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant19AuthorizeUrl`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "format": "uri",
///  "maxLength": 4096
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant19AuthorizeUrl(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant19AuthorizeUrl
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant19AuthorizeUrl>
    for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant19AuthorizeUrl,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant19AuthorizeUrl
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 4096usize {
            return Err("longer than 4096 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant19AuthorizeUrl
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant19AuthorizeUrl
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant19AuthorizeUrl
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant19AuthorizeUrl
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Area`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "working",
///    "staged"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Area {
    #[serde(rename = "working")]
    Working,
    #[serde(rename = "staged")]
    Staged,
}
impl ::std::fmt::Display for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Area {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Working => f.write_str("working"),
            Self::Staged => f.write_str("staged"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Area {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "working" => Ok(Self::Working),
            "staged" => Ok(Self::Staged),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Area
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Area
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Area
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Path`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 4096,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Path(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Path {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Path>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Path) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Path {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 4096usize {
            return Err("longer than 4096 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Path
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Path
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Path
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant1Path
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "id",
///    "label"
///  ],
///  "properties": {
///    "id": {
///      "type": "string",
///      "maxLength": 128,
///      "minLength": 1,
///      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$"
///    },
///    "label": {
///      "type": "string",
///      "maxLength": 256,
///      "minLength": 1
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItem {
    pub id: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemId,
    pub label: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemLabel,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 128,
///  "minLength": 1,
///  "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$"
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemId(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemId
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemId>
    for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemId,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemId
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 128usize {
            return Err("longer than 128 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| {
                ::regress::Regex::new("^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$").unwrap()
            });
        if PATTERN.find(value).is_none() {
            return Err("doesn't match pattern \"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$\"".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemId
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemId
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemLabel`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 256,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemLabel(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemLabel
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemLabel,
    > for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemLabel,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemLabel
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 256usize {
            return Err("longer than 256 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemLabel
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemLabel
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemLabel
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant21ModelsItemLabel
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "object",
///      "required": [
///        "kind",
///        "model",
///        "outcome",
///        "text"
///      ],
///      "properties": {
///        "kind": {
///          "type": "string",
///          "const": "chatgpt_generation"
///        },
///        "model": {
///          "type": "string",
///          "maxLength": 128,
///          "minLength": 1,
///          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$"
///        },
///        "outcome": {
///          "type": "string",
///          "const": "completed"
///        },
///        "text": {
///          "type": "string",
///          "maxLength": 200000
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "kind",
///        "outcome",
///        "reason"
///      ],
///      "properties": {
///        "code": {
///          "type": "string",
///          "maxLength": 128,
///          "minLength": 1
///        },
///        "httpStatus": {
///          "type": "integer",
///          "maximum": 599.0,
///          "minimum": 100.0
///        },
///        "kind": {
///          "type": "string",
///          "const": "chatgpt_generation"
///        },
///        "outcome": {
///          "type": "string",
///          "const": "failed"
///        },
///        "param": {
///          "type": "string",
///          "maxLength": 128,
///          "minLength": 1
///        },
///        "reason": {
///          "type": "string",
///          "enum": [
///            "usage_limit",
///            "not_eligible",
///            "plan_disabled",
///            "reconnect",
///            "unsupported",
///            "route_not_supported",
///            "permission",
///            "region_or_policy",
///            "temporarily_unavailable",
///            "incomplete",
///            "interrupted",
///            "model_unavailable",
///            "signed_out",
///            "failed"
///          ]
///        },
///        "requestId": {
///          "type": "string",
///          "maxLength": 128,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    }
///  ]
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(tag = "outcome", deny_unknown_fields)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22 {
    #[serde(rename = "completed")]
    Completed {
        kind: ::std::string::String,
        model: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Model,
        text: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Text,
    },
    #[serde(rename = "failed")]
    Failed {
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        code: ::std::option::Option<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Code,
        >,
        #[serde(
            rename = "httpStatus",
            default,
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        http_status: ::std::option::Option<i64>,
        kind: ::std::string::String,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        param: ::std::option::Option<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Param,
        >,
        reason: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Reason,
        #[serde(
            rename = "requestId",
            default,
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        request_id: ::std::option::Option<
            ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22RequestId,
        >,
    },
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Code`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 128,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Code(
    ::std::string::String,
);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Code {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Code>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Code) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Code {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 128usize {
            return Err("longer than 128 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Code
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Code
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Code
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Code
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Model`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 128,
///  "minLength": 1,
///  "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$"
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Model(
    ::std::string::String,
);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Model {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Model>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Model) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Model {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 128usize {
            return Err("longer than 128 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| {
                ::regress::Regex::new("^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$").unwrap()
            });
        if PATTERN.find(value).is_none() {
            return Err("doesn't match pattern \"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$\"".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Model
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Model
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Model
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Model
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Param`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 128,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Param(
    ::std::string::String,
);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Param {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Param>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Param) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Param {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 128usize {
            return Err("longer than 128 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Param
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Param
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Param
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Param
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Reason`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "usage_limit",
///    "not_eligible",
///    "plan_disabled",
///    "reconnect",
///    "unsupported",
///    "route_not_supported",
///    "permission",
///    "region_or_policy",
///    "temporarily_unavailable",
///    "incomplete",
///    "interrupted",
///    "model_unavailable",
///    "signed_out",
///    "failed"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Reason {
    #[serde(rename = "usage_limit")]
    UsageLimit,
    #[serde(rename = "not_eligible")]
    NotEligible,
    #[serde(rename = "plan_disabled")]
    PlanDisabled,
    #[serde(rename = "reconnect")]
    Reconnect,
    #[serde(rename = "unsupported")]
    Unsupported,
    #[serde(rename = "route_not_supported")]
    RouteNotSupported,
    #[serde(rename = "permission")]
    Permission,
    #[serde(rename = "region_or_policy")]
    RegionOrPolicy,
    #[serde(rename = "temporarily_unavailable")]
    TemporarilyUnavailable,
    #[serde(rename = "incomplete")]
    Incomplete,
    #[serde(rename = "interrupted")]
    Interrupted,
    #[serde(rename = "model_unavailable")]
    ModelUnavailable,
    #[serde(rename = "signed_out")]
    SignedOut,
    #[serde(rename = "failed")]
    Failed,
}
impl ::std::fmt::Display for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Reason {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::UsageLimit => f.write_str("usage_limit"),
            Self::NotEligible => f.write_str("not_eligible"),
            Self::PlanDisabled => f.write_str("plan_disabled"),
            Self::Reconnect => f.write_str("reconnect"),
            Self::Unsupported => f.write_str("unsupported"),
            Self::RouteNotSupported => f.write_str("route_not_supported"),
            Self::Permission => f.write_str("permission"),
            Self::RegionOrPolicy => f.write_str("region_or_policy"),
            Self::TemporarilyUnavailable => f.write_str("temporarily_unavailable"),
            Self::Incomplete => f.write_str("incomplete"),
            Self::Interrupted => f.write_str("interrupted"),
            Self::ModelUnavailable => f.write_str("model_unavailable"),
            Self::SignedOut => f.write_str("signed_out"),
            Self::Failed => f.write_str("failed"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Reason {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "usage_limit" => Ok(Self::UsageLimit),
            "not_eligible" => Ok(Self::NotEligible),
            "plan_disabled" => Ok(Self::PlanDisabled),
            "reconnect" => Ok(Self::Reconnect),
            "unsupported" => Ok(Self::Unsupported),
            "route_not_supported" => Ok(Self::RouteNotSupported),
            "permission" => Ok(Self::Permission),
            "region_or_policy" => Ok(Self::RegionOrPolicy),
            "temporarily_unavailable" => Ok(Self::TemporarilyUnavailable),
            "incomplete" => Ok(Self::Incomplete),
            "interrupted" => Ok(Self::Interrupted),
            "model_unavailable" => Ok(Self::ModelUnavailable),
            "signed_out" => Ok(Self::SignedOut),
            "failed" => Ok(Self::Failed),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Reason
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Reason
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Reason
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22RequestId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 128,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22RequestId(
    ::std::string::String,
);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22RequestId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22RequestId>
    for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22RequestId,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22RequestId
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 128usize {
            return Err("longer than 128 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22RequestId
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22RequestId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22RequestId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22RequestId
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Text`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 200000
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Text(
    ::std::string::String,
);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Text {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Text>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Text) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Text {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 200000usize {
            return Err("longer than 200000 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Text
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Text
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Text
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant22Text
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2Status`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "ahead",
///    "behind",
///    "branches",
///    "files",
///    "gitWorkspaces",
///    "head",
///    "kind",
///    "oid",
///    "operation",
///    "remotes",
///    "repository",
///    "stashes",
///    "upstream"
///  ],
///  "properties": {
///    "ahead": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 0.0
///    },
///    "behind": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 0.0
///    },
///    "branches": {
///      "type": "array",
///      "items": {
///        "type": "object",
///        "required": [
///          "ahead",
///          "current",
///          "name",
///          "remote",
///          "shortOid",
///          "upstream"
///        ],
///        "properties": {
///          "ahead": {
///            "default": null,
///            "anyOf": [
///              {
///                "type": "integer",
///                "maximum": 9007199254740991.0,
///                "minimum": 0.0
///              },
///              {
///                "type": "null"
///              }
///            ]
///          },
///          "current": {
///            "type": "boolean"
///          },
///          "name": {
///            "type": "string"
///          },
///          "remote": {
///            "type": "boolean"
///          },
///          "shortOid": {
///            "type": "string"
///          },
///          "upstream": {
///            "anyOf": [
///              {
///                "type": "string"
///              },
///              {
///                "type": "null"
///              }
///            ]
///          }
///        },
///        "additionalProperties": false
///      }
///    },
///    "files": {
///      "type": "array",
///      "items": {
///        "type": "object",
///        "required": [
///          "index",
///          "kind",
///          "path",
///          "submodule",
///          "worktree"
///        ],
///        "properties": {
///          "index": {
///            "type": "string",
///            "maxLength": 1,
///            "minLength": 1
///          },
///          "kind": {
///            "type": "string",
///            "enum": [
///              "tracked",
///              "untracked",
///              "conflict"
///            ]
///          },
///          "originalPath": {
///            "anyOf": [
///              {
///                "type": "string",
///                "maxLength": 4096,
///                "minLength": 1
///              },
///              {
///                "type": "null"
///              }
///            ]
///          },
///          "path": {
///            "type": "string",
///            "maxLength": 4096,
///            "minLength": 1
///          },
///          "submodule": {
///            "type": "boolean"
///          },
///          "worktree": {
///            "type": "string",
///            "maxLength": 1,
///            "minLength": 1
///          }
///        },
///        "additionalProperties": false
///      }
///    },
///    "gitWorkspaces": {
///      "default": [],
///      "type": "array",
///      "items": {
///        "type": "object",
///        "required": [
///          "branch",
///          "path"
///        ],
///        "properties": {
///          "branch": {
///            "anyOf": [
///              {
///                "type": "string"
///              },
///              {
///                "type": "null"
///              }
///            ]
///          },
///          "path": {
///            "type": "string"
///          }
///        },
///        "additionalProperties": false
///      }
///    },
///    "head": {
///      "anyOf": [
///        {
///          "type": "string"
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "kind": {
///      "type": "string",
///      "const": "status"
///    },
///    "oid": {
///      "anyOf": [
///        {
///          "type": "string"
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "operation": {
///      "anyOf": [
///        {
///          "type": "string",
///          "enum": [
///            "merge",
///            "rebase",
///            "cherry-pick",
///            "revert",
///            "bisect"
///          ]
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "remotes": {
///      "type": "array",
///      "items": {
///        "type": "string"
///      }
///    },
///    "repository": {
///      "type": "boolean"
///    },
///    "stashes": {
///      "default": 0,
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 0.0
///    },
///    "upstream": {
///      "anyOf": [
///        {
///          "type": "string"
///        },
///        {
///          "type": "null"
///        }
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2Status {
    pub ahead: i64,
    pub behind: i64,
    pub branches: ::std::vec::Vec<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusBranchesItem,
    >,
    pub files: ::std::vec::Vec<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItem,
    >,
    #[serde(rename = "gitWorkspaces")]
    pub git_workspaces: ::std::vec::Vec<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusGitWorkspacesItem,
    >,
    pub head: ::std::option::Option<::std::string::String>,
    pub kind: ::std::string::String,
    pub oid: ::std::option::Option<::std::string::String>,
    pub operation: ::std::option::Option<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusOperation,
    >,
    pub remotes: ::std::vec::Vec<::std::string::String>,
    pub repository: bool,
    pub stashes: i64,
    pub upstream: ::std::option::Option<::std::string::String>,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusBranchesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "ahead",
///    "current",
///    "name",
///    "remote",
///    "shortOid",
///    "upstream"
///  ],
///  "properties": {
///    "ahead": {
///      "default": null,
///      "anyOf": [
///        {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": 0.0
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "current": {
///      "type": "boolean"
///    },
///    "name": {
///      "type": "string"
///    },
///    "remote": {
///      "type": "boolean"
///    },
///    "shortOid": {
///      "type": "string"
///    },
///    "upstream": {
///      "anyOf": [
///        {
///          "type": "string"
///        },
///        {
///          "type": "null"
///        }
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusBranchesItem {
    pub ahead: ::std::option::Option<i64>,
    pub current: bool,
    pub name: ::std::string::String,
    pub remote: bool,
    #[serde(rename = "shortOid")]
    pub short_oid: ::std::string::String,
    pub upstream: ::std::option::Option<::std::string::String>,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "index",
///    "kind",
///    "path",
///    "submodule",
///    "worktree"
///  ],
///  "properties": {
///    "index": {
///      "type": "string",
///      "maxLength": 1,
///      "minLength": 1
///    },
///    "kind": {
///      "type": "string",
///      "enum": [
///        "tracked",
///        "untracked",
///        "conflict"
///      ]
///    },
///    "originalPath": {
///      "anyOf": [
///        {
///          "type": "string",
///          "maxLength": 4096,
///          "minLength": 1
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "path": {
///      "type": "string",
///      "maxLength": 4096,
///      "minLength": 1
///    },
///    "submodule": {
///      "type": "boolean"
///    },
///    "worktree": {
///      "type": "string",
///      "maxLength": 1,
///      "minLength": 1
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItem {
    pub index: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemIndex,
    pub kind: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemKind,
    #[serde(
        rename = "originalPath",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub original_path: ::std::option::Option<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemOriginalPath,
    >,
    pub path: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemPath,
    pub submodule: bool,
    pub worktree:
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemWorktree,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemIndex`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 1,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemIndex(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemIndex
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemIndex,
    > for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemIndex,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemIndex
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 1usize {
            return Err("longer than 1 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemIndex
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemIndex
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemIndex
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemIndex
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemKind`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "tracked",
///    "untracked",
///    "conflict"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemKind {
    #[serde(rename = "tracked")]
    Tracked,
    #[serde(rename = "untracked")]
    Untracked,
    #[serde(rename = "conflict")]
    Conflict,
}
impl ::std::fmt::Display
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemKind
{
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Tracked => f.write_str("tracked"),
            Self::Untracked => f.write_str("untracked"),
            Self::Conflict => f.write_str("conflict"),
        }
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemKind
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "tracked" => Ok(Self::Tracked),
            "untracked" => Ok(Self::Untracked),
            "conflict" => Ok(Self::Conflict),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemKind
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemKind
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemKind
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemOriginalPath`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 4096,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemOriginalPath(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemOriginalPath
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemOriginalPath,
    > for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemOriginalPath,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemOriginalPath
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 4096usize {
            return Err("longer than 4096 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemOriginalPath
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemOriginalPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemOriginalPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemOriginalPath
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemPath`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 4096,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemPath(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemPath
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemPath,
    > for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemPath,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemPath
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 4096usize {
            return Err("longer than 4096 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemPath
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemPath
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemWorktree`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 1,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemWorktree(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemWorktree
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemWorktree,
    > for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemWorktree,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemWorktree
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 1usize {
            return Err("longer than 1 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemWorktree
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemWorktree
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemWorktree
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusFilesItemWorktree
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusGitWorkspacesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "branch",
///    "path"
///  ],
///  "properties": {
///    "branch": {
///      "anyOf": [
///        {
///          "type": "string"
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "path": {
///      "type": "string"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusGitWorkspacesItem {
    pub branch: ::std::option::Option<::std::string::String>,
    pub path: ::std::string::String,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusOperation`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "merge",
///    "rebase",
///    "cherry-pick",
///    "revert",
///    "bisect"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusOperation {
    #[serde(rename = "merge")]
    Merge,
    #[serde(rename = "rebase")]
    Rebase,
    #[serde(rename = "cherry-pick")]
    CherryPick,
    #[serde(rename = "revert")]
    Revert,
    #[serde(rename = "bisect")]
    Bisect,
}
impl ::std::fmt::Display
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusOperation
{
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Merge => f.write_str("merge"),
            Self::Rebase => f.write_str("rebase"),
            Self::CherryPick => f.write_str("cherry-pick"),
            Self::Revert => f.write_str("revert"),
            Self::Bisect => f.write_str("bisect"),
        }
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusOperation
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "merge" => Ok(Self::Merge),
            "rebase" => Ok(Self::Rebase),
            "cherry-pick" => Ok(Self::CherryPick),
            "revert" => Ok(Self::Revert),
            "bisect" => Ok(Self::Bisect),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusOperation
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusOperation
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2StatusOperation
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2Workspace`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "branch",
///    "id",
///    "localPath",
///    "name",
///    "slug"
///  ],
///  "properties": {
///    "branch": {
///      "anyOf": [
///        {
///          "type": "string"
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "id": {
///      "type": "string",
///      "minLength": 1
///    },
///    "localPath": {
///      "type": "string",
///      "minLength": 1
///    },
///    "name": {
///      "type": "string",
///      "minLength": 1
///    },
///    "slug": {
///      "type": "string",
///      "minLength": 1
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2Workspace {
    pub branch: ::std::option::Option<::std::string::String>,
    pub id: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceId,
    #[serde(rename = "localPath")]
    pub local_path: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceLocalPath,
    pub name: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceName,
    pub slug: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceSlug,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceId(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceId
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceId>
    for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceId,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceId
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceId
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceId
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceLocalPath`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceLocalPath(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceLocalPath
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceLocalPath,
    > for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceLocalPath,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceLocalPath
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceLocalPath
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceLocalPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceLocalPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceLocalPath
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceName`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceName(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceName
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceName>
    for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceName,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceName
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceName
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceName
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceSlug`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceSlug(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceSlug
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceSlug>
    for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceSlug,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceSlug
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceSlug
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceSlug
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceSlug
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant2WorkspaceSlug
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant3ReasonsItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 512
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant3ReasonsItem(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant3ReasonsItem
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant3ReasonsItem>
    for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant3ReasonsItem,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant3ReasonsItem
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 512usize {
            return Err("longer than 512 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant3ReasonsItem
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant3ReasonsItem
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant3ReasonsItem
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant3ReasonsItem
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant4LocalPath`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant4LocalPath(
    ::std::string::String,
);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant4LocalPath {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant4LocalPath>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant4LocalPath) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant4LocalPath
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant4LocalPath
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant4LocalPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant4LocalPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant4LocalPath
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant5CommitsItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "authorEmail",
///    "authorName",
///    "authoredAt",
///    "committedAt",
///    "oid",
///    "parents",
///    "refs",
///    "shortOid",
///    "subject"
///  ],
///  "properties": {
///    "authorEmail": {
///      "type": "string"
///    },
///    "authorName": {
///      "type": "string"
///    },
///    "authoredAt": {
///      "type": "string"
///    },
///    "committedAt": {
///      "type": "string"
///    },
///    "oid": {
///      "type": "string"
///    },
///    "parents": {
///      "type": "array",
///      "items": {
///        "type": "string"
///      }
///    },
///    "refs": {
///      "type": "array",
///      "items": {
///        "type": "string"
///      }
///    },
///    "shortOid": {
///      "type": "string"
///    },
///    "subject": {
///      "type": "string"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant5CommitsItem {
    #[serde(rename = "authorEmail")]
    pub author_email: ::std::string::String,
    #[serde(rename = "authorName")]
    pub author_name: ::std::string::String,
    #[serde(rename = "authoredAt")]
    pub authored_at: ::std::string::String,
    #[serde(rename = "committedAt")]
    pub committed_at: ::std::string::String,
    pub oid: ::std::string::String,
    pub parents: ::std::vec::Vec<::std::string::String>,
    pub refs: ::std::vec::Vec<::std::string::String>,
    #[serde(rename = "shortOid")]
    pub short_oid: ::std::string::String,
    pub subject: ::std::string::String,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant6FilesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "additions",
///    "binary",
///    "deletions",
///    "path",
///    "status"
///  ],
///  "properties": {
///    "additions": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 0.0
///    },
///    "binary": {
///      "type": "boolean"
///    },
///    "deletions": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 0.0
///    },
///    "oldPath": {
///      "type": "string"
///    },
///    "path": {
///      "type": "string"
///    },
///    "status": {
///      "type": "string",
///      "enum": [
///        "A",
///        "M",
///        "D",
///        "R",
///        "C",
///        "T"
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant6FilesItem {
    pub additions: i64,
    pub binary: bool,
    pub deletions: i64,
    #[serde(
        rename = "oldPath",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub old_path: ::std::option::Option<::std::string::String>,
    pub path: ::std::string::String,
    pub status: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant6FilesItemStatus,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant6FilesItemStatus`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "A",
///    "M",
///    "D",
///    "R",
///    "C",
///    "T"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant6FilesItemStatus {
    A,
    M,
    D,
    R,
    C,
    T,
}
impl ::std::fmt::Display
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant6FilesItemStatus
{
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::A => f.write_str("A"),
            Self::M => f.write_str("M"),
            Self::D => f.write_str("D"),
            Self::R => f.write_str("R"),
            Self::C => f.write_str("C"),
            Self::T => f.write_str("T"),
        }
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant6FilesItemStatus
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "A" => Ok(Self::A),
            "M" => Ok(Self::M),
            "D" => Ok(Self::D),
            "R" => Ok(Self::R),
            "C" => Ok(Self::C),
            "T" => Ok(Self::T),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant6FilesItemStatus
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant6FilesItemStatus
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant6FilesItemStatus
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant8Area`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "working",
///    "staged"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant8Area {
    #[serde(rename = "working")]
    Working,
    #[serde(rename = "staged")]
    Staged,
}
impl ::std::fmt::Display for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant8Area {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Working => f.write_str("working"),
            Self::Staged => f.write_str("staged"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant8Area {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "working" => Ok(Self::Working),
            "staged" => Ok(Self::Staged),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant8Area
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant8Area
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant8Area
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant9FilesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "additions",
///    "binary",
///    "deletions",
///    "path",
///    "status"
///  ],
///  "properties": {
///    "additions": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 0.0
///    },
///    "binary": {
///      "type": "boolean"
///    },
///    "deletions": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": 0.0
///    },
///    "oldPath": {
///      "type": "string"
///    },
///    "path": {
///      "type": "string"
///    },
///    "status": {
///      "type": "string",
///      "enum": [
///        "A",
///        "M",
///        "D",
///        "R",
///        "C",
///        "T"
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant9FilesItem {
    pub additions: i64,
    pub binary: bool,
    pub deletions: i64,
    #[serde(
        rename = "oldPath",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub old_path: ::std::option::Option<::std::string::String>,
    pub path: ::std::string::String,
    pub status: ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant9FilesItemStatus,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant9FilesItemStatus`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "A",
///    "M",
///    "D",
///    "R",
///    "C",
///    "T"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant9FilesItemStatus {
    A,
    M,
    D,
    R,
    C,
    T,
}
impl ::std::fmt::Display
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant9FilesItemStatus
{
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::A => f.write_str("A"),
            Self::M => f.write_str("M"),
            Self::D => f.write_str("D"),
            Self::R => f.write_str("R"),
            Self::C => f.write_str("C"),
            Self::T => f.write_str("T"),
        }
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant9FilesItemStatus
{
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "A" => Ok(Self::A),
            "M" => Ok(Self::M),
            "D" => Ok(Self::D),
            "R" => Ok(Self::R),
            "C" => Ok(Self::C),
            "T" => Ok(Self::T),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant9FilesItemStatus
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant9FilesItemStatus
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueVariant9FilesItemStatus
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant1Error`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "code",
///    "message"
///  ],
///  "properties": {
///    "code": {
///      "type": "string",
///      "enum": [
///        "LOCAL_EXECUTOR_OFFLINE",
///        "EXECUTOR_WAKING",
///        "TOOL_TIMEOUT",
///        "CANCELLED",
///        "PATH_ESCAPE",
///        "PATH_NOT_FOUND",
///        "TOOL_FAILED",
///        "INVALID_ARGUMENTS",
///        "UNKNOWN_TOOL",
///        "UNKNOWN_PROJECT",
///        "UNKNOWN_WORKSPACE",
///        "WORKSPACE_UNAVAILABLE",
///        "UNKNOWN_PROCESS",
///        "NO_ACTIVE_PROJECT",
///        "FORBIDDEN",
///        "APPROVAL_DECLINED",
///        "APPROVAL_TIMEOUT",
///        "INTERNAL_ERROR"
///      ]
///    },
///    "message": {
///      "type": "string"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageResultVariant1Error {
    pub code: ExeoraProtocolTypesExecutorMessageResultVariant1ErrorCode,
    pub message: ::std::string::String,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant1ErrorCode`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "LOCAL_EXECUTOR_OFFLINE",
///    "EXECUTOR_WAKING",
///    "TOOL_TIMEOUT",
///    "CANCELLED",
///    "PATH_ESCAPE",
///    "PATH_NOT_FOUND",
///    "TOOL_FAILED",
///    "INVALID_ARGUMENTS",
///    "UNKNOWN_TOOL",
///    "UNKNOWN_PROJECT",
///    "UNKNOWN_WORKSPACE",
///    "WORKSPACE_UNAVAILABLE",
///    "UNKNOWN_PROCESS",
///    "NO_ACTIVE_PROJECT",
///    "FORBIDDEN",
///    "APPROVAL_DECLINED",
///    "APPROVAL_TIMEOUT",
///    "INTERNAL_ERROR"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant1ErrorCode {
    #[serde(rename = "LOCAL_EXECUTOR_OFFLINE")]
    LocalExecutorOffline,
    #[serde(rename = "EXECUTOR_WAKING")]
    ExecutorWaking,
    #[serde(rename = "TOOL_TIMEOUT")]
    ToolTimeout,
    #[serde(rename = "CANCELLED")]
    Cancelled,
    #[serde(rename = "PATH_ESCAPE")]
    PathEscape,
    #[serde(rename = "PATH_NOT_FOUND")]
    PathNotFound,
    #[serde(rename = "TOOL_FAILED")]
    ToolFailed,
    #[serde(rename = "INVALID_ARGUMENTS")]
    InvalidArguments,
    #[serde(rename = "UNKNOWN_TOOL")]
    UnknownTool,
    #[serde(rename = "UNKNOWN_PROJECT")]
    UnknownProject,
    #[serde(rename = "UNKNOWN_WORKSPACE")]
    UnknownWorkspace,
    #[serde(rename = "WORKSPACE_UNAVAILABLE")]
    WorkspaceUnavailable,
    #[serde(rename = "UNKNOWN_PROCESS")]
    UnknownProcess,
    #[serde(rename = "NO_ACTIVE_PROJECT")]
    NoActiveProject,
    #[serde(rename = "FORBIDDEN")]
    Forbidden,
    #[serde(rename = "APPROVAL_DECLINED")]
    ApprovalDeclined,
    #[serde(rename = "APPROVAL_TIMEOUT")]
    ApprovalTimeout,
    #[serde(rename = "INTERNAL_ERROR")]
    InternalError,
}
impl ::std::fmt::Display for ExeoraProtocolTypesExecutorMessageResultVariant1ErrorCode {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::LocalExecutorOffline => f.write_str("LOCAL_EXECUTOR_OFFLINE"),
            Self::ExecutorWaking => f.write_str("EXECUTOR_WAKING"),
            Self::ToolTimeout => f.write_str("TOOL_TIMEOUT"),
            Self::Cancelled => f.write_str("CANCELLED"),
            Self::PathEscape => f.write_str("PATH_ESCAPE"),
            Self::PathNotFound => f.write_str("PATH_NOT_FOUND"),
            Self::ToolFailed => f.write_str("TOOL_FAILED"),
            Self::InvalidArguments => f.write_str("INVALID_ARGUMENTS"),
            Self::UnknownTool => f.write_str("UNKNOWN_TOOL"),
            Self::UnknownProject => f.write_str("UNKNOWN_PROJECT"),
            Self::UnknownWorkspace => f.write_str("UNKNOWN_WORKSPACE"),
            Self::WorkspaceUnavailable => f.write_str("WORKSPACE_UNAVAILABLE"),
            Self::UnknownProcess => f.write_str("UNKNOWN_PROCESS"),
            Self::NoActiveProject => f.write_str("NO_ACTIVE_PROJECT"),
            Self::Forbidden => f.write_str("FORBIDDEN"),
            Self::ApprovalDeclined => f.write_str("APPROVAL_DECLINED"),
            Self::ApprovalTimeout => f.write_str("APPROVAL_TIMEOUT"),
            Self::InternalError => f.write_str("INTERNAL_ERROR"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant1ErrorCode {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "LOCAL_EXECUTOR_OFFLINE" => Ok(Self::LocalExecutorOffline),
            "EXECUTOR_WAKING" => Ok(Self::ExecutorWaking),
            "TOOL_TIMEOUT" => Ok(Self::ToolTimeout),
            "CANCELLED" => Ok(Self::Cancelled),
            "PATH_ESCAPE" => Ok(Self::PathEscape),
            "PATH_NOT_FOUND" => Ok(Self::PathNotFound),
            "TOOL_FAILED" => Ok(Self::ToolFailed),
            "INVALID_ARGUMENTS" => Ok(Self::InvalidArguments),
            "UNKNOWN_TOOL" => Ok(Self::UnknownTool),
            "UNKNOWN_PROJECT" => Ok(Self::UnknownProject),
            "UNKNOWN_WORKSPACE" => Ok(Self::UnknownWorkspace),
            "WORKSPACE_UNAVAILABLE" => Ok(Self::WorkspaceUnavailable),
            "UNKNOWN_PROCESS" => Ok(Self::UnknownProcess),
            "NO_ACTIVE_PROJECT" => Ok(Self::NoActiveProject),
            "FORBIDDEN" => Ok(Self::Forbidden),
            "APPROVAL_DECLINED" => Ok(Self::ApprovalDeclined),
            "APPROVAL_TIMEOUT" => Ok(Self::ApprovalTimeout),
            "INTERNAL_ERROR" => Ok(Self::InternalError),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageResultVariant1ErrorCode {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant1ErrorCode
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant1ErrorCode
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageRun`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "exitCode",
///    "finishedAt",
///    "runId",
///    "scriptSha256",
///    "source",
///    "startedAt",
///    "status",
///    "trigger",
///    "truncated"
///  ],
///  "properties": {
///    "exitCode": {
///      "anyOf": [
///        {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": -9007199254740991.0
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "finishedAt": {
///      "anyOf": [
///        {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": -9007199254740991.0
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "output": {
///      "type": "string",
///      "maxLength": 16000
///    },
///    "runId": {
///      "type": "string",
///      "maxLength": 64,
///      "minLength": 1
///    },
///    "scriptSha256": {
///      "anyOf": [
///        {
///          "type": "string",
///          "maxLength": 64,
///          "minLength": 64
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "source": {
///      "type": "string",
///      "enum": [
///        "dashboard",
///        "repository",
///        "none"
///      ]
///    },
///    "startedAt": {
///      "type": "integer",
///      "maximum": 9007199254740991.0,
///      "minimum": -9007199254740991.0
///    },
///    "status": {
///      "type": "string",
///      "enum": [
///        "running",
///        "ok",
///        "failed",
///        "timed_out",
///        "skipped"
///      ]
///    },
///    "trigger": {
///      "type": "string",
///      "enum": [
///        "setup",
///        "changed",
///        "manual",
///        "cold",
///        "warm"
///      ]
///    },
///    "truncated": {
///      "default": false,
///      "type": "boolean"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageRun {
    #[serde(rename = "exitCode")]
    pub exit_code: ::std::option::Option<i64>,
    #[serde(rename = "finishedAt")]
    pub finished_at: ::std::option::Option<i64>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub output: ::std::option::Option<ExeoraProtocolTypesExecutorMessageRunOutput>,
    #[serde(rename = "runId")]
    pub run_id: ExeoraProtocolTypesExecutorMessageRunRunId,
    #[serde(rename = "scriptSha256")]
    pub script_sha256: ::std::option::Option<ExeoraProtocolTypesExecutorMessageRunScriptSha256>,
    pub source: ExeoraProtocolTypesExecutorMessageRunSource,
    #[serde(rename = "startedAt")]
    pub started_at: i64,
    pub status: ExeoraProtocolTypesExecutorMessageRunStatus,
    pub trigger: ExeoraProtocolTypesExecutorMessageRunTrigger,
    pub truncated: bool,
}
///`ExeoraProtocolTypesExecutorMessageRunOutput`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 16000
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageRunOutput(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageRunOutput {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageRunOutput> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesExecutorMessageRunOutput) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageRunOutput {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 16000usize {
            return Err("longer than 16000 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageRunOutput {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageRunOutput
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageRunOutput
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesExecutorMessageRunOutput {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageRunRunId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 64,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageRunRunId(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageRunRunId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageRunRunId> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesExecutorMessageRunRunId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageRunRunId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 64usize {
            return Err("longer than 64 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageRunRunId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageRunRunId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesExecutorMessageRunRunId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesExecutorMessageRunRunId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageRunScriptSha256`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 64,
///  "minLength": 64
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageRunScriptSha256(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageRunScriptSha256 {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageRunScriptSha256>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageRunScriptSha256) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageRunScriptSha256 {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 64usize {
            return Err("longer than 64 characters".into());
        }
        if value.chars().count() < 64usize {
            return Err("shorter than 64 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageRunScriptSha256 {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageRunScriptSha256
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageRunScriptSha256
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesExecutorMessageRunScriptSha256 {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageRunSource`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "dashboard",
///    "repository",
///    "none"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageRunSource {
    #[serde(rename = "dashboard")]
    Dashboard,
    #[serde(rename = "repository")]
    Repository,
    #[serde(rename = "none")]
    None,
}
impl ::std::fmt::Display for ExeoraProtocolTypesExecutorMessageRunSource {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Dashboard => f.write_str("dashboard"),
            Self::Repository => f.write_str("repository"),
            Self::None => f.write_str("none"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageRunSource {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "dashboard" => Ok(Self::Dashboard),
            "repository" => Ok(Self::Repository),
            "none" => Ok(Self::None),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageRunSource {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageRunSource
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageRunSource
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageRunStatus`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "running",
///    "ok",
///    "failed",
///    "timed_out",
///    "skipped"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageRunStatus {
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "ok")]
    Ok,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "timed_out")]
    TimedOut,
    #[serde(rename = "skipped")]
    Skipped,
}
impl ::std::fmt::Display for ExeoraProtocolTypesExecutorMessageRunStatus {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Running => f.write_str("running"),
            Self::Ok => f.write_str("ok"),
            Self::Failed => f.write_str("failed"),
            Self::TimedOut => f.write_str("timed_out"),
            Self::Skipped => f.write_str("skipped"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageRunStatus {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "running" => Ok(Self::Running),
            "ok" => Ok(Self::Ok),
            "failed" => Ok(Self::Failed),
            "timed_out" => Ok(Self::TimedOut),
            "skipped" => Ok(Self::Skipped),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageRunStatus {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageRunStatus
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageRunStatus
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageRunTrigger`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "setup",
///    "changed",
///    "manual",
///    "cold",
///    "warm"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesExecutorMessageRunTrigger {
    #[serde(rename = "setup")]
    Setup,
    #[serde(rename = "changed")]
    Changed,
    #[serde(rename = "manual")]
    Manual,
    #[serde(rename = "cold")]
    Cold,
    #[serde(rename = "warm")]
    Warm,
}
impl ::std::fmt::Display for ExeoraProtocolTypesExecutorMessageRunTrigger {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Setup => f.write_str("setup"),
            Self::Changed => f.write_str("changed"),
            Self::Manual => f.write_str("manual"),
            Self::Cold => f.write_str("cold"),
            Self::Warm => f.write_str("warm"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageRunTrigger {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "setup" => Ok(Self::Setup),
            "changed" => Ok(Self::Changed),
            "manual" => Ok(Self::Manual),
            "cold" => Ok(Self::Cold),
            "warm" => Ok(Self::Warm),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageRunTrigger {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageRunTrigger
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageRunTrigger
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageSessionId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 128,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageSessionId(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageSessionId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageSessionId> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesExecutorMessageSessionId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageSessionId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 128usize {
            return Err("longer than 128 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageSessionId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageSessionId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageSessionId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesExecutorMessageSessionId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageToolsItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "exposedName",
///    "inputSchema",
///    "name",
///    "server"
///  ],
///  "properties": {
///    "annotations": {
///      "type": "object",
///      "properties": {
///        "destructiveHint": {
///          "type": "boolean"
///        },
///        "idempotentHint": {
///          "type": "boolean"
///        },
///        "openWorldHint": {
///          "type": "boolean"
///        },
///        "readOnlyHint": {
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    },
///    "description": {
///      "type": "string",
///      "maxLength": 4096
///    },
///    "exposedName": {
///      "type": "string",
///      "maxLength": 64,
///      "minLength": 1,
///      "pattern": "^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+(?:__[a-f0-9]{10})?$"
///    },
///    "inputSchema": {
///      "type": "object",
///      "additionalProperties": {},
///      "propertyNames": {
///        "type": "string"
///      }
///    },
///    "name": {
///      "type": "string",
///      "maxLength": 128,
///      "minLength": 1
///    },
///    "server": {
///      "type": "string",
///      "maxLength": 64,
///      "minLength": 1
///    },
///    "title": {
///      "type": "string",
///      "maxLength": 512
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageToolsItem {
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub annotations: ::std::option::Option<ExeoraProtocolTypesExecutorMessageToolsItemAnnotations>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub description: ::std::option::Option<ExeoraProtocolTypesExecutorMessageToolsItemDescription>,
    #[serde(rename = "exposedName")]
    pub exposed_name: ExeoraProtocolTypesExecutorMessageToolsItemExposedName,
    #[serde(rename = "inputSchema")]
    pub input_schema: ::serde_json::Map<::std::string::String, ::serde_json::Value>,
    pub name: ExeoraProtocolTypesExecutorMessageToolsItemName,
    pub server: ExeoraProtocolTypesExecutorMessageToolsItemServer,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub title: ::std::option::Option<ExeoraProtocolTypesExecutorMessageToolsItemTitle>,
}
///`ExeoraProtocolTypesExecutorMessageToolsItemAnnotations`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "properties": {
///    "destructiveHint": {
///      "type": "boolean"
///    },
///    "idempotentHint": {
///      "type": "boolean"
///    },
///    "openWorldHint": {
///      "type": "boolean"
///    },
///    "readOnlyHint": {
///      "type": "boolean"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageToolsItemAnnotations {
    #[serde(
        rename = "destructiveHint",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub destructive_hint: ::std::option::Option<bool>,
    #[serde(
        rename = "idempotentHint",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub idempotent_hint: ::std::option::Option<bool>,
    #[serde(
        rename = "openWorldHint",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub open_world_hint: ::std::option::Option<bool>,
    #[serde(
        rename = "readOnlyHint",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub read_only_hint: ::std::option::Option<bool>,
}
impl ::std::default::Default for ExeoraProtocolTypesExecutorMessageToolsItemAnnotations {
    fn default() -> Self {
        Self {
            destructive_hint: Default::default(),
            idempotent_hint: Default::default(),
            open_world_hint: Default::default(),
            read_only_hint: Default::default(),
        }
    }
}
///`ExeoraProtocolTypesExecutorMessageToolsItemDescription`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 4096
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageToolsItemDescription(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageToolsItemDescription {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageToolsItemDescription>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageToolsItemDescription) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageToolsItemDescription {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 4096usize {
            return Err("longer than 4096 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageToolsItemDescription {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageToolsItemDescription
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageToolsItemDescription
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesExecutorMessageToolsItemDescription {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageToolsItemExposedName`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 64,
///  "minLength": 1,
///  "pattern": "^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+(?:__[a-f0-9]{10})?$"
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageToolsItemExposedName(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageToolsItemExposedName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageToolsItemExposedName>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageToolsItemExposedName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageToolsItemExposedName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 64usize {
            return Err("longer than 64 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| {
                ::regress::Regex::new("^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+(?:__[a-f0-9]{10})?$")
                    .unwrap()
            });
        if PATTERN.find(value).is_none() {
            return Err(
                "doesn't match pattern \"^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+(?:__[a-f0-9]{10})?$\""
                    .into(),
            );
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageToolsItemExposedName {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageToolsItemExposedName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageToolsItemExposedName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesExecutorMessageToolsItemExposedName {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageToolsItemName`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 128,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageToolsItemName(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageToolsItemName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageToolsItemName>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageToolsItemName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageToolsItemName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 128usize {
            return Err("longer than 128 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageToolsItemName {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageToolsItemName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageToolsItemName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesExecutorMessageToolsItemName {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageToolsItemServer`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 64,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageToolsItemServer(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageToolsItemServer {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageToolsItemServer>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageToolsItemServer) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageToolsItemServer {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 64usize {
            return Err("longer than 64 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageToolsItemServer {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageToolsItemServer
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageToolsItemServer
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesExecutorMessageToolsItemServer {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesExecutorMessageToolsItemTitle`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 512
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesExecutorMessageToolsItemTitle(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageToolsItemTitle {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageToolsItemTitle>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageToolsItemTitle) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageToolsItemTitle {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 512usize {
            return Err("longer than 512 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageToolsItemTitle {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageToolsItemTitle
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageToolsItemTitle
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesExecutorMessageToolsItemTitle {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesLocalCommandPolicy`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "properties": {
///    "allow": {
///      "type": "array",
///      "items": {
///        "type": "string"
///      }
///    },
///    "approve": {
///      "type": "boolean"
///    },
///    "deny": {
///      "type": "array",
///      "items": {
///        "type": "string"
///      }
///    },
///    "mode": {
///      "type": "string",
///      "enum": [
///        "allow_all",
///        "allow_list",
///        "read_only"
///      ]
///    },
///    "shell": {
///      "type": "boolean"
///    },
///    "tools": {
///      "type": "array",
///      "items": {
///        "type": "string",
///        "enum": [
///          "read_file",
///          "list_files",
///          "grep",
///          "edit_file",
///          "write_file",
///          "apply_patch",
///          "list_git_workspaces",
///          "create_workspace",
///          "attach_workspace",
///          "detach_workspace",
///          "remove_workspace",
///          "run_command",
///          "start_command",
///          "get_command_output",
///          "send_command_input",
///          "kill_command",
///          "list_skills"
///        ]
///      }
///    }
///  },
///  "additionalProperties": false,
///  "$schema": "https://json-schema.org/draft/2020-12/schema"
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesLocalCommandPolicy {
    #[serde(default, skip_serializing_if = "::std::vec::Vec::is_empty")]
    pub allow: ::std::vec::Vec<::std::string::String>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub approve: ::std::option::Option<bool>,
    #[serde(default, skip_serializing_if = "::std::vec::Vec::is_empty")]
    pub deny: ::std::vec::Vec<::std::string::String>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub mode: ::std::option::Option<ExeoraProtocolTypesLocalCommandPolicyMode>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub shell: ::std::option::Option<bool>,
    #[serde(default, skip_serializing_if = "::std::vec::Vec::is_empty")]
    pub tools: ::std::vec::Vec<ExeoraProtocolTypesLocalCommandPolicyToolsItem>,
}
impl ::std::default::Default for ExeoraProtocolTypesLocalCommandPolicy {
    fn default() -> Self {
        Self {
            allow: Default::default(),
            approve: Default::default(),
            deny: Default::default(),
            mode: Default::default(),
            shell: Default::default(),
            tools: Default::default(),
        }
    }
}
///`ExeoraProtocolTypesLocalCommandPolicyMode`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "allow_all",
///    "allow_list",
///    "read_only"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesLocalCommandPolicyMode {
    #[serde(rename = "allow_all")]
    AllowAll,
    #[serde(rename = "allow_list")]
    AllowList,
    #[serde(rename = "read_only")]
    ReadOnly,
}
impl ::std::fmt::Display for ExeoraProtocolTypesLocalCommandPolicyMode {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::AllowAll => f.write_str("allow_all"),
            Self::AllowList => f.write_str("allow_list"),
            Self::ReadOnly => f.write_str("read_only"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesLocalCommandPolicyMode {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "allow_all" => Ok(Self::AllowAll),
            "allow_list" => Ok(Self::AllowList),
            "read_only" => Ok(Self::ReadOnly),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesLocalCommandPolicyMode {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesLocalCommandPolicyMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesLocalCommandPolicyMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesLocalCommandPolicyToolsItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "read_file",
///    "list_files",
///    "grep",
///    "edit_file",
///    "write_file",
///    "apply_patch",
///    "list_git_workspaces",
///    "create_workspace",
///    "attach_workspace",
///    "detach_workspace",
///    "remove_workspace",
///    "run_command",
///    "start_command",
///    "get_command_output",
///    "send_command_input",
///    "kill_command",
///    "list_skills"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesLocalCommandPolicyToolsItem {
    #[serde(rename = "read_file")]
    ReadFile,
    #[serde(rename = "list_files")]
    ListFiles,
    #[serde(rename = "grep")]
    Grep,
    #[serde(rename = "edit_file")]
    EditFile,
    #[serde(rename = "write_file")]
    WriteFile,
    #[serde(rename = "apply_patch")]
    ApplyPatch,
    #[serde(rename = "list_git_workspaces")]
    ListGitWorkspaces,
    #[serde(rename = "create_workspace")]
    CreateWorkspace,
    #[serde(rename = "attach_workspace")]
    AttachWorkspace,
    #[serde(rename = "detach_workspace")]
    DetachWorkspace,
    #[serde(rename = "remove_workspace")]
    RemoveWorkspace,
    #[serde(rename = "run_command")]
    RunCommand,
    #[serde(rename = "start_command")]
    StartCommand,
    #[serde(rename = "get_command_output")]
    GetCommandOutput,
    #[serde(rename = "send_command_input")]
    SendCommandInput,
    #[serde(rename = "kill_command")]
    KillCommand,
    #[serde(rename = "list_skills")]
    ListSkills,
}
impl ::std::fmt::Display for ExeoraProtocolTypesLocalCommandPolicyToolsItem {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::ReadFile => f.write_str("read_file"),
            Self::ListFiles => f.write_str("list_files"),
            Self::Grep => f.write_str("grep"),
            Self::EditFile => f.write_str("edit_file"),
            Self::WriteFile => f.write_str("write_file"),
            Self::ApplyPatch => f.write_str("apply_patch"),
            Self::ListGitWorkspaces => f.write_str("list_git_workspaces"),
            Self::CreateWorkspace => f.write_str("create_workspace"),
            Self::AttachWorkspace => f.write_str("attach_workspace"),
            Self::DetachWorkspace => f.write_str("detach_workspace"),
            Self::RemoveWorkspace => f.write_str("remove_workspace"),
            Self::RunCommand => f.write_str("run_command"),
            Self::StartCommand => f.write_str("start_command"),
            Self::GetCommandOutput => f.write_str("get_command_output"),
            Self::SendCommandInput => f.write_str("send_command_input"),
            Self::KillCommand => f.write_str("kill_command"),
            Self::ListSkills => f.write_str("list_skills"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesLocalCommandPolicyToolsItem {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "read_file" => Ok(Self::ReadFile),
            "list_files" => Ok(Self::ListFiles),
            "grep" => Ok(Self::Grep),
            "edit_file" => Ok(Self::EditFile),
            "write_file" => Ok(Self::WriteFile),
            "apply_patch" => Ok(Self::ApplyPatch),
            "list_git_workspaces" => Ok(Self::ListGitWorkspaces),
            "create_workspace" => Ok(Self::CreateWorkspace),
            "attach_workspace" => Ok(Self::AttachWorkspace),
            "detach_workspace" => Ok(Self::DetachWorkspace),
            "remove_workspace" => Ok(Self::RemoveWorkspace),
            "run_command" => Ok(Self::RunCommand),
            "start_command" => Ok(Self::StartCommand),
            "get_command_output" => Ok(Self::GetCommandOutput),
            "send_command_input" => Ok(Self::SendCommandInput),
            "kill_command" => Ok(Self::KillCommand),
            "list_skills" => Ok(Self::ListSkills),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesLocalCommandPolicyToolsItem {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesLocalCommandPolicyToolsItem
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesLocalCommandPolicyToolsItem
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesRelayMessage`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "object",
///      "required": [
///        "heartbeatIntervalMs",
///        "serverTime",
///        "type"
///      ],
///      "properties": {
///        "cloudHooks": {
///          "type": "object",
///          "required": [
///            "repository",
///            "scripts"
///          ],
///          "properties": {
///            "repository": {
///              "default": true,
///              "type": "boolean"
///            },
///            "scripts": {
///              "anyOf": [
///                {
///                  "type": "object",
///                  "required": [
///                    "install",
///                    "resume"
///                  ],
///                  "properties": {
///                    "install": {
///                      "anyOf": [
///                        {
///                          "type": "string",
///                          "maxLength": 16384
///                        },
///                        {
///                          "type": "null"
///                        }
///                      ]
///                    },
///                    "resume": {
///                      "anyOf": [
///                        {
///                          "type": "string",
///                          "maxLength": 16384
///                        },
///                        {
///                          "type": "null"
///                        }
///                      ]
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            }
///          },
///          "additionalProperties": false
///        },
///        "heartbeatIntervalMs": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": -9007199254740991.0
///        },
///        "heartbeatMode": {
///          "type": "string",
///          "const": "auto"
///        },
///        "latestCliVersion": {
///          "type": "string"
///        },
///        "serverTime": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": -9007199254740991.0
///        },
///        "type": {
///          "type": "string",
///          "const": "hello.ack"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "type"
///      ],
///      "properties": {
///        "type": {
///          "type": "string",
///          "const": "heartbeat.ack"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "arguments",
///        "expiresAt",
///        "issuedAt",
///        "projectId",
///        "requestId",
///        "tool",
///        "type"
///      ],
///      "properties": {
///        "arguments": {},
///        "client": {
///          "type": "object",
///          "properties": {
///            "id": {
///              "type": "string"
///            },
///            "name": {
///              "type": "string"
///            },
///            "version": {
///              "type": "string"
///            }
///          },
///          "additionalProperties": false
///        },
///        "expiresAt": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": -9007199254740991.0
///        },
///        "issuedAt": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": -9007199254740991.0
///        },
///        "policy": {
///          "type": "object",
///          "required": [
///            "allow",
///            "approve",
///            "deny",
///            "mode",
///            "shell",
///            "tools"
///          ],
///          "properties": {
///            "allow": {
///              "default": [],
///              "type": "array",
///              "items": {
///                "type": "string"
///              }
///            },
///            "approve": {
///              "default": false,
///              "type": "boolean"
///            },
///            "deny": {
///              "default": [],
///              "type": "array",
///              "items": {
///                "type": "string"
///              }
///            },
///            "mode": {
///              "type": "string",
///              "enum": [
///                "allow_all",
///                "allow_list",
///                "read_only"
///              ]
///            },
///            "shell": {
///              "default": false,
///              "type": "boolean"
///            },
///            "tools": {
///              "default": null,
///              "anyOf": [
///                {
///                  "type": "array",
///                  "items": {
///                    "type": "string",
///                    "enum": [
///                      "read_file",
///                      "list_files",
///                      "grep",
///                      "edit_file",
///                      "write_file",
///                      "apply_patch",
///                      "list_git_workspaces",
///                      "create_workspace",
///                      "attach_workspace",
///                      "detach_workspace",
///                      "remove_workspace",
///                      "run_command",
///                      "start_command",
///                      "get_command_output",
///                      "send_command_input",
///                      "kill_command",
///                      "list_skills"
///                    ]
///                  }
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            }
///          },
///          "additionalProperties": false
///        },
///        "projectId": {
///          "type": "string"
///        },
///        "requestId": {
///          "type": "string"
///        },
///        "tool": {
///          "type": "string",
///          "enum": [
///            "read_file",
///            "list_files",
///            "grep",
///            "edit_file",
///            "write_file",
///            "apply_patch",
///            "list_git_workspaces",
///            "create_workspace",
///            "attach_workspace",
///            "detach_workspace",
///            "remove_workspace",
///            "run_command",
///            "start_command",
///            "get_command_output",
///            "send_command_input",
///            "kill_command",
///            "list_skills"
///          ]
///        },
///        "type": {
///          "type": "string",
///          "const": "tool.call"
///        },
///        "workspaceId": {
///          "type": "string"
///        },
///        "workspaceSlug": {
///          "type": "string"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "arguments",
///        "expiresAt",
///        "issuedAt",
///        "policy",
///        "projectId",
///        "requestId",
///        "server",
///        "tool",
///        "type"
///      ],
///      "properties": {
///        "arguments": {},
///        "client": {
///          "type": "object",
///          "properties": {
///            "id": {
///              "type": "string"
///            },
///            "name": {
///              "type": "string"
///            },
///            "version": {
///              "type": "string"
///            }
///          },
///          "additionalProperties": false
///        },
///        "expiresAt": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": -9007199254740991.0
///        },
///        "issuedAt": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": -9007199254740991.0
///        },
///        "policy": {
///          "type": "object",
///          "required": [
///            "allow",
///            "approve",
///            "deny",
///            "mode",
///            "shell",
///            "tools"
///          ],
///          "properties": {
///            "allow": {
///              "default": [],
///              "type": "array",
///              "items": {
///                "type": "string"
///              }
///            },
///            "approve": {
///              "default": false,
///              "type": "boolean"
///            },
///            "deny": {
///              "default": [],
///              "type": "array",
///              "items": {
///                "type": "string"
///              }
///            },
///            "mode": {
///              "type": "string",
///              "enum": [
///                "allow_all",
///                "allow_list",
///                "read_only"
///              ]
///            },
///            "shell": {
///              "default": false,
///              "type": "boolean"
///            },
///            "tools": {
///              "default": null,
///              "anyOf": [
///                {
///                  "type": "array",
///                  "items": {
///                    "type": "string",
///                    "enum": [
///                      "read_file",
///                      "list_files",
///                      "grep",
///                      "edit_file",
///                      "write_file",
///                      "apply_patch",
///                      "list_git_workspaces",
///                      "create_workspace",
///                      "attach_workspace",
///                      "detach_workspace",
///                      "remove_workspace",
///                      "run_command",
///                      "start_command",
///                      "get_command_output",
///                      "send_command_input",
///                      "kill_command",
///                      "list_skills"
///                    ]
///                  }
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            }
///          },
///          "additionalProperties": false
///        },
///        "projectId": {
///          "type": "string"
///        },
///        "requestId": {
///          "type": "string"
///        },
///        "server": {
///          "type": "string",
///          "maxLength": 64,
///          "minLength": 1
///        },
///        "tool": {
///          "type": "string",
///          "maxLength": 128,
///          "minLength": 1
///        },
///        "type": {
///          "type": "string",
///          "const": "mcp.call"
///        },
///        "workspaceId": {
///          "type": "string"
///        },
///        "workspaceSlug": {
///          "type": "string"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "expiresAt",
///        "issuedAt",
///        "projectId",
///        "requestId",
///        "type"
///      ],
///      "properties": {
///        "action": {
///          "oneOf": [
///            {
///              "type": "object",
///              "required": [
///                "action"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "status"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "area",
///                "path"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "diff"
///                },
///                "area": {
///                  "type": "string",
///                  "enum": [
///                    "working",
///                    "staged"
///                  ]
///                },
///                "path": {
///                  "type": "string",
///                  "maxLength": 4096,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "unpublished"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "paths"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "stage"
///                },
///                "paths": {
///                  "type": "array",
///                  "items": {
///                    "type": "string",
///                    "maxLength": 4096,
///                    "minLength": 1
///                  },
///                  "maxItems": 1000,
///                  "minItems": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "paths"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "unstage"
///                },
///                "paths": {
///                  "type": "array",
///                  "items": {
///                    "type": "string",
///                    "maxLength": 4096,
///                    "minLength": 1
///                  },
///                  "maxItems": 1000,
///                  "minItems": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "paths"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "discard"
///                },
///                "paths": {
///                  "type": "array",
///                  "items": {
///                    "type": "string",
///                    "maxLength": 4096,
///                    "minLength": 1
///                  },
///                  "maxItems": 1000,
///                  "minItems": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "paths"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "delete_untracked"
///                },
///                "paths": {
///                  "type": "array",
///                  "items": {
///                    "type": "string",
///                    "maxLength": 4096,
///                    "minLength": 1
///                  },
///                  "maxItems": 1000,
///                  "minItems": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "message"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "commit"
///                },
///                "message": {
///                  "type": "string",
///                  "maxLength": 10000,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "all"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "fetch"
///                },
///                "all": {
///                  "default": false,
///                  "type": "boolean"
///                },
///                "remote": {
///                  "type": "string",
///                  "maxLength": 512,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "pull"
///                },
///                "branch": {
///                  "type": "string",
///                  "maxLength": 512,
///                  "minLength": 1
///                },
///                "remote": {
///                  "type": "string",
///                  "maxLength": 512,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "setUpstream"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "push"
///                },
///                "remote": {
///                  "type": "string",
///                  "maxLength": 512,
///                  "minLength": 1
///                },
///                "setUpstream": {
///                  "default": false,
///                  "type": "boolean"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "name"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "branch_create"
///                },
///                "name": {
///                  "type": "string",
///                  "maxLength": 255,
///                  "minLength": 1
///                },
///                "startPoint": {
///                  "type": "string",
///                  "maxLength": 512,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "name"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "branch_switch"
///                },
///                "name": {
///                  "type": "string",
///                  "maxLength": 255,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "name",
///                "remoteBranch"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "branch_track"
///                },
///                "name": {
///                  "type": "string",
///                  "maxLength": 255,
///                  "minLength": 1
///                },
///                "remoteBranch": {
///                  "type": "string",
///                  "maxLength": 512,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "name"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "branch_delete"
///                },
///                "name": {
///                  "type": "string",
///                  "maxLength": 255,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "branch",
///                "reuseExistingBranch"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "workspace_create"
///                },
///                "branch": {
///                  "type": "string",
///                  "maxLength": 255,
///                  "minLength": 1
///                },
///                "from": {
///                  "type": "string",
///                  "maxLength": 512,
///                  "minLength": 1
///                },
///                "name": {
///                  "type": "string",
///                  "maxLength": 100,
///                  "minLength": 1
///                },
///                "reuseExistingBranch": {
///                  "default": false,
///                  "type": "boolean"
///                },
///                "slug": {
///                  "type": "string",
///                  "maxLength": 60,
///                  "minLength": 1,
///                  "pattern": "^[a-z0-9][a-z0-9-]*$"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "repository"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "project_prepare"
///                },
///                "repository": {
///                  "type": "object",
///                  "required": [
///                    "credential",
///                    "name",
///                    "slug",
///                    "url"
///                  ],
///                  "properties": {
///                    "credential": {
///                      "default": "machine",
///                      "type": "string",
///                      "enum": [
///                        "exeora",
///                        "machine"
///                      ]
///                    },
///                    "defaultBranch": {
///                      "type": "string",
///                      "maxLength": 255,
///                      "minLength": 1
///                    },
///                    "name": {
///                      "type": "string",
///                      "maxLength": 100,
///                      "minLength": 1
///                    },
///                    "slug": {
///                      "type": "string",
///                      "maxLength": 60,
///                      "minLength": 1,
///                      "pattern": "^[a-z0-9][a-z0-9-]*$"
///                    },
///                    "url": {
///                      "type": "string",
///                      "maxLength": 1000,
///                      "minLength": 1
///                    }
///                  },
///                  "additionalProperties": false
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "limit"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "log"
///                },
///                "cursor": {
///                  "type": "string",
///                  "maxLength": 64
///                },
///                "limit": {
///                  "default": 30,
///                  "type": "integer",
///                  "maximum": 100.0,
///                  "minimum": 1.0
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "oid"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "commit_detail"
///                },
///                "oid": {
///                  "type": "string",
///                  "pattern": "^[0-9a-f]{4,64}$"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "oid"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "commit_diff"
///                },
///                "oid": {
///                  "type": "string",
///                  "pattern": "^[0-9a-f]{4,64}$"
///                },
///                "path": {
///                  "type": "string",
///                  "maxLength": 4096,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "area"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "diff_all"
///                },
///                "area": {
///                  "type": "string",
///                  "enum": [
///                    "working",
///                    "staged"
///                  ]
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "base"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "range_diff"
///                },
///                "base": {
///                  "type": "string",
///                  "maxLength": 512,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "staged_context"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "base"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "range_context"
///                },
///                "base": {
///                  "type": "string",
///                  "maxLength": 512,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "stash_list"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "amend"
///                },
///                "message": {
///                  "type": "string",
///                  "maxLength": 10000,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "includeUntracked"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "stash_push"
///                },
///                "includeUntracked": {
///                  "default": true,
///                  "type": "boolean"
///                },
///                "message": {
///                  "type": "string",
///                  "maxLength": 1000,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "index"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "stash_pop"
///                },
///                "index": {
///                  "default": 0,
///                  "type": "integer",
///                  "maximum": 9007199254740991.0,
///                  "minimum": 0.0
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "index"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "stash_drop"
///                },
///                "index": {
///                  "type": "integer",
///                  "maximum": 9007199254740991.0,
///                  "minimum": 0.0
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "sync"
///                },
///                "remote": {
///                  "type": "string",
///                  "maxLength": 512,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "discard_all"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "path",
///                "showIgnored"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "tree"
///                },
///                "path": {
///                  "default": ".",
///                  "type": "string",
///                  "maxLength": 4096,
///                  "minLength": 1
///                },
///                "showIgnored": {
///                  "default": false,
///                  "type": "boolean"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "encoding",
///                "path"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "file_read"
///                },
///                "encoding": {
///                  "default": "text",
///                  "type": "string",
///                  "enum": [
///                    "text",
///                    "base64"
///                  ]
///                },
///                "path": {
///                  "type": "string",
///                  "maxLength": 4096,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "content",
///                "create",
///                "path"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "file_write"
///                },
///                "content": {
///                  "type": "string",
///                  "maxLength": 1000000
///                },
///                "create": {
///                  "default": true,
///                  "type": "boolean"
///                },
///                "expectedToken": {
///                  "type": "string",
///                  "maxLength": 64
///                },
///                "path": {
///                  "type": "string",
///                  "maxLength": 4096,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "path",
///                "type"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "file_create"
///                },
///                "path": {
///                  "type": "string",
///                  "maxLength": 4096,
///                  "minLength": 1
///                },
///                "type": {
///                  "type": "string",
///                  "enum": [
///                    "file",
///                    "directory"
///                  ]
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "from",
///                "overwrite",
///                "to"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "file_rename"
///                },
///                "from": {
///                  "type": "string",
///                  "maxLength": 4096,
///                  "minLength": 1
///                },
///                "overwrite": {
///                  "default": false,
///                  "type": "boolean"
///                },
///                "to": {
///                  "type": "string",
///                  "maxLength": 4096,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "overwrite",
///                "paths",
///                "to"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "file_move"
///                },
///                "overwrite": {
///                  "default": false,
///                  "type": "boolean"
///                },
///                "paths": {
///                  "type": "array",
///                  "items": {
///                    "type": "string",
///                    "maxLength": 4096,
///                    "minLength": 1
///                  },
///                  "maxItems": 100,
///                  "minItems": 1
///                },
///                "to": {
///                  "type": "string",
///                  "maxLength": 4096,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "paths"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "file_delete"
///                },
///                "paths": {
///                  "type": "array",
///                  "items": {
///                    "type": "string",
///                    "maxLength": 4096,
///                    "minLength": 1
///                  },
///                  "maxItems": 100,
///                  "minItems": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "path"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "file_duplicate"
///                },
///                "path": {
///                  "type": "string",
///                  "maxLength": 4096,
///                  "minLength": 1
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "caseSensitive",
///                "includeIgnored",
///                "maxPerFile",
///                "maxResults",
///                "query",
///                "regex",
///                "wholeWord"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "search"
///                },
///                "caseSensitive": {
///                  "default": false,
///                  "type": "boolean"
///                },
///                "exclude": {
///                  "type": "string",
///                  "maxLength": 1000
///                },
///                "include": {
///                  "type": "string",
///                  "maxLength": 1000
///                },
///                "includeIgnored": {
///                  "default": false,
///                  "type": "boolean"
///                },
///                "maxPerFile": {
///                  "default": 50,
///                  "type": "integer",
///                  "maximum": 100.0,
///                  "minimum": 1.0
///                },
///                "maxResults": {
///                  "default": 500,
///                  "type": "integer",
///                  "maximum": 2000.0,
///                  "minimum": 1.0
///                },
///                "path": {
///                  "type": "string",
///                  "maxLength": 4096,
///                  "minLength": 1
///                },
///                "query": {
///                  "type": "string",
///                  "maxLength": 1000,
///                  "minLength": 1
///                },
///                "regex": {
///                  "default": false,
///                  "type": "boolean"
///                },
///                "wholeWord": {
///                  "default": false,
///                  "type": "boolean"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "caseSensitive",
///                "preserveCase",
///                "query",
///                "regex",
///                "replacement",
///                "targets",
///                "wholeWord"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "replace"
///                },
///                "caseSensitive": {
///                  "default": false,
///                  "type": "boolean"
///                },
///                "preserveCase": {
///                  "default": false,
///                  "type": "boolean"
///                },
///                "query": {
///                  "type": "string",
///                  "maxLength": 1000,
///                  "minLength": 1
///                },
///                "regex": {
///                  "default": false,
///                  "type": "boolean"
///                },
///                "replacement": {
///                  "type": "string",
///                  "maxLength": 10000
///                },
///                "targets": {
///                  "type": "array",
///                  "items": {
///                    "type": "object",
///                    "required": [
///                      "path",
///                      "token"
///                    ],
///                    "properties": {
///                      "lines": {
///                        "type": "array",
///                        "items": {
///                          "type": "integer",
///                          "maximum": 9007199254740991.0,
///                          "minimum": 1.0
///                        },
///                        "maxItems": 100
///                      },
///                      "path": {
///                        "type": "string",
///                        "maxLength": 4096,
///                        "minLength": 1
///                      },
///                      "token": {
///                        "type": "string",
///                        "maxLength": 64
///                      }
///                    },
///                    "additionalProperties": false
///                  },
///                  "maxItems": 500,
///                  "minItems": 1
///                },
///                "wholeWord": {
///                  "default": false,
///                  "type": "boolean"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "chatgpt_status"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "mode"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "chatgpt_login_start"
///                },
///                "mode": {
///                  "type": "string",
///                  "enum": [
///                    "new",
///                    "reauth",
///                    "enable_plan"
///                  ]
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "chatgpt_login_cancel"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "chatgpt_logout"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "chatgpt_models"
///                }
///              },
///              "additionalProperties": false
///            },
///            {
///              "type": "object",
///              "required": [
///                "action",
///                "input",
///                "instructions"
///              ],
///              "properties": {
///                "action": {
///                  "type": "string",
///                  "const": "chatgpt_generate"
///                },
///                "input": {
///                  "type": "string",
///                  "maxLength": 220000
///                },
///                "instructions": {
///                  "type": "string",
///                  "maxLength": 4000
///                },
///                "model": {
///                  "type": "string",
///                  "maxLength": 128,
///                  "minLength": 1,
///                  "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$"
///                }
///              },
///              "additionalProperties": false
///            }
///          ]
///        },
///        "expiresAt": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": -9007199254740991.0
///        },
///        "issuedAt": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": -9007199254740991.0
///        },
///        "projectId": {
///          "type": "string"
///        },
///        "requestId": {
///          "type": "string"
///        },
///        "type": {
///          "type": "string",
///          "const": "workspace.call"
///        },
///        "workspaceId": {
///          "type": "string"
///        },
///        "workspaceSlug": {
///          "type": "string"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "requestId",
///        "type"
///      ],
///      "properties": {
///        "requestId": {
///          "type": "string"
///        },
///        "type": {
///          "type": "string",
///          "const": "cancel"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "reason",
///        "type"
///      ],
///      "properties": {
///        "reason": {
///          "type": "string"
///        },
///        "type": {
///          "type": "string",
///          "const": "shutdown"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "expiresAt",
///        "id",
///        "projectId",
///        "prompt",
///        "tool",
///        "type"
///      ],
///      "properties": {
///        "client": {
///          "type": "object",
///          "properties": {
///            "name": {
///              "type": "string"
///            },
///            "version": {
///              "type": "string"
///            }
///          },
///          "additionalProperties": false
///        },
///        "expiresAt": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": -9007199254740991.0
///        },
///        "id": {
///          "type": "string"
///        },
///        "projectId": {
///          "type": "string"
///        },
///        "prompt": {
///          "type": "string"
///        },
///        "tool": {
///          "type": "string",
///          "maxLength": 128
///        },
///        "type": {
///          "type": "string",
///          "const": "approval.request"
///        },
///        "workspaceId": {
///          "type": "string"
///        },
///        "workspaceSlug": {
///          "type": "string"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "id",
///        "type"
///      ],
///      "properties": {
///        "id": {
///          "type": "string"
///        },
///        "type": {
///          "type": "string",
///          "const": "approval.resolved"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "cols",
///        "projectId",
///        "rows",
///        "sessionId",
///        "type"
///      ],
///      "properties": {
///        "cols": {
///          "type": "integer",
///          "maximum": 500.0,
///          "minimum": 20.0
///        },
///        "projectId": {
///          "type": "string"
///        },
///        "rows": {
///          "type": "integer",
///          "maximum": 300.0,
///          "minimum": 5.0
///        },
///        "sessionId": {
///          "type": "string",
///          "maxLength": 128,
///          "minLength": 1
///        },
///        "type": {
///          "type": "string",
///          "const": "terminal.open"
///        },
///        "workspaceId": {
///          "type": "string"
///        },
///        "workspaceSlug": {
///          "type": "string"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "data",
///        "sessionId",
///        "type"
///      ],
///      "properties": {
///        "data": {
///          "type": "string",
///          "maxLength": 128000
///        },
///        "sessionId": {
///          "type": "string",
///          "maxLength": 128,
///          "minLength": 1
///        },
///        "type": {
///          "type": "string",
///          "const": "terminal.input"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "cols",
///        "rows",
///        "sessionId",
///        "type"
///      ],
///      "properties": {
///        "cols": {
///          "type": "integer",
///          "maximum": 500.0,
///          "minimum": 20.0
///        },
///        "rows": {
///          "type": "integer",
///          "maximum": 300.0,
///          "minimum": 5.0
///        },
///        "sessionId": {
///          "type": "string",
///          "maxLength": 128,
///          "minLength": 1
///        },
///        "type": {
///          "type": "string",
///          "const": "terminal.resize"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "sessionId",
///        "type"
///      ],
///      "properties": {
///        "sessionId": {
///          "type": "string",
///          "maxLength": 128,
///          "minLength": 1
///        },
///        "type": {
///          "type": "string",
///          "const": "terminal.close"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "config",
///        "hook",
///        "type"
///      ],
///      "properties": {
///        "config": {
///          "type": "object",
///          "required": [
///            "repository",
///            "scripts"
///          ],
///          "properties": {
///            "repository": {
///              "default": true,
///              "type": "boolean"
///            },
///            "scripts": {
///              "anyOf": [
///                {
///                  "type": "object",
///                  "required": [
///                    "install",
///                    "resume"
///                  ],
///                  "properties": {
///                    "install": {
///                      "anyOf": [
///                        {
///                          "type": "string",
///                          "maxLength": 16384
///                        },
///                        {
///                          "type": "null"
///                        }
///                      ]
///                    },
///                    "resume": {
///                      "anyOf": [
///                        {
///                          "type": "string",
///                          "maxLength": 16384
///                        },
///                        {
///                          "type": "null"
///                        }
///                      ]
///                    }
///                  },
///                  "additionalProperties": false
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            }
///          },
///          "additionalProperties": false
///        },
///        "hook": {
///          "type": "string",
///          "enum": [
///            "install",
///            "resume"
///          ]
///        },
///        "type": {
///          "type": "string",
///          "const": "cloud.hook.run"
///        }
///      },
///      "additionalProperties": false
///    }
///  ],
///  "$schema": "https://json-schema.org/draft/2020-12/schema"
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum ExeoraProtocolTypesRelayMessage {
    #[serde(rename = "hello.ack")]
    HelloAck {
        #[serde(
            rename = "cloudHooks",
            default,
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        cloud_hooks: ::std::option::Option<ExeoraProtocolTypesRelayMessageCloudHooks>,
        #[serde(rename = "heartbeatIntervalMs")]
        heartbeat_interval_ms: i64,
        #[serde(
            rename = "heartbeatMode",
            default,
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        heartbeat_mode: ::std::option::Option<::std::string::String>,
        #[serde(
            rename = "latestCliVersion",
            default,
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        latest_cli_version: ::std::option::Option<::std::string::String>,
        #[serde(rename = "serverTime")]
        server_time: i64,
    },
    #[serde(rename = "heartbeat.ack")]
    HeartbeatAck,
    #[serde(rename = "tool.call")]
    ToolCall {
        arguments: ::serde_json::Value,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        client: ::std::option::Option<ExeoraProtocolTypesRelayMessageClient>,
        #[serde(rename = "expiresAt")]
        expires_at: i64,
        #[serde(rename = "issuedAt")]
        issued_at: i64,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        policy: ::std::option::Option<ExeoraProtocolTypesRelayMessagePolicy>,
        #[serde(rename = "projectId")]
        project_id: ::std::string::String,
        #[serde(rename = "requestId")]
        request_id: ::std::string::String,
        tool: ExeoraProtocolTypesRelayMessageTool,
        #[serde(
            rename = "workspaceId",
            default,
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        workspace_id: ::std::option::Option<::std::string::String>,
        #[serde(
            rename = "workspaceSlug",
            default,
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        workspace_slug: ::std::option::Option<::std::string::String>,
    },
    #[serde(rename = "mcp.call")]
    McpCall {
        arguments: ::serde_json::Value,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        client: ::std::option::Option<ExeoraProtocolTypesRelayMessageClient>,
        #[serde(rename = "expiresAt")]
        expires_at: i64,
        #[serde(rename = "issuedAt")]
        issued_at: i64,
        policy: ExeoraProtocolTypesRelayMessagePolicy,
        #[serde(rename = "projectId")]
        project_id: ::std::string::String,
        #[serde(rename = "requestId")]
        request_id: ::std::string::String,
        server: ExeoraProtocolTypesRelayMessageServer,
        tool: ExeoraProtocolTypesRelayMessageTool,
        #[serde(
            rename = "workspaceId",
            default,
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        workspace_id: ::std::option::Option<::std::string::String>,
        #[serde(
            rename = "workspaceSlug",
            default,
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        workspace_slug: ::std::option::Option<::std::string::String>,
    },
    #[serde(rename = "workspace.call")]
    WorkspaceCall {
        action: ExeoraProtocolTypesRelayMessageAction,
        #[serde(rename = "expiresAt")]
        expires_at: i64,
        #[serde(rename = "issuedAt")]
        issued_at: i64,
        #[serde(rename = "projectId")]
        project_id: ::std::string::String,
        #[serde(rename = "requestId")]
        request_id: ::std::string::String,
        #[serde(
            rename = "workspaceId",
            default,
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        workspace_id: ::std::option::Option<::std::string::String>,
        #[serde(
            rename = "workspaceSlug",
            default,
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        workspace_slug: ::std::option::Option<::std::string::String>,
    },
    #[serde(rename = "cancel")]
    Cancel {
        #[serde(rename = "requestId")]
        request_id: ::std::string::String,
    },
    #[serde(rename = "shutdown")]
    Shutdown { reason: ::std::string::String },
    #[serde(rename = "approval.request")]
    ApprovalRequest {
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        client: ::std::option::Option<ExeoraProtocolTypesRelayMessageClient>,
        #[serde(rename = "expiresAt")]
        expires_at: i64,
        id: ::std::string::String,
        #[serde(rename = "projectId")]
        project_id: ::std::string::String,
        prompt: ::std::string::String,
        tool: ExeoraProtocolTypesRelayMessageTool,
        #[serde(
            rename = "workspaceId",
            default,
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        workspace_id: ::std::option::Option<::std::string::String>,
        #[serde(
            rename = "workspaceSlug",
            default,
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        workspace_slug: ::std::option::Option<::std::string::String>,
    },
    #[serde(rename = "approval.resolved")]
    ApprovalResolved { id: ::std::string::String },
    #[serde(rename = "terminal.open")]
    TerminalOpen {
        cols: i64,
        #[serde(rename = "projectId")]
        project_id: ::std::string::String,
        rows: i64,
        #[serde(rename = "sessionId")]
        session_id: ExeoraProtocolTypesRelayMessageSessionId,
        #[serde(
            rename = "workspaceId",
            default,
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        workspace_id: ::std::option::Option<::std::string::String>,
        #[serde(
            rename = "workspaceSlug",
            default,
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        workspace_slug: ::std::option::Option<::std::string::String>,
    },
    #[serde(rename = "terminal.input")]
    TerminalInput {
        data: ExeoraProtocolTypesRelayMessageData,
        #[serde(rename = "sessionId")]
        session_id: ExeoraProtocolTypesRelayMessageSessionId,
    },
    #[serde(rename = "terminal.resize")]
    TerminalResize {
        cols: i64,
        rows: i64,
        #[serde(rename = "sessionId")]
        session_id: ExeoraProtocolTypesRelayMessageSessionId,
    },
    #[serde(rename = "terminal.close")]
    TerminalClose {
        #[serde(rename = "sessionId")]
        session_id: ExeoraProtocolTypesRelayMessageSessionId,
    },
    #[serde(rename = "cloud.hook.run")]
    CloudHookRun {
        config: ExeoraProtocolTypesRelayMessageConfig,
        hook: ExeoraProtocolTypesRelayMessageHook,
    },
}
///`ExeoraProtocolTypesRelayMessageAction`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "oneOf": [
///    {
///      "type": "object",
///      "required": [
///        "action"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "status"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "area",
///        "path"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "diff"
///        },
///        "area": {
///          "type": "string",
///          "enum": [
///            "working",
///            "staged"
///          ]
///        },
///        "path": {
///          "type": "string",
///          "maxLength": 4096,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "unpublished"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "paths"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "stage"
///        },
///        "paths": {
///          "type": "array",
///          "items": {
///            "type": "string",
///            "maxLength": 4096,
///            "minLength": 1
///          },
///          "maxItems": 1000,
///          "minItems": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "paths"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "unstage"
///        },
///        "paths": {
///          "type": "array",
///          "items": {
///            "type": "string",
///            "maxLength": 4096,
///            "minLength": 1
///          },
///          "maxItems": 1000,
///          "minItems": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "paths"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "discard"
///        },
///        "paths": {
///          "type": "array",
///          "items": {
///            "type": "string",
///            "maxLength": 4096,
///            "minLength": 1
///          },
///          "maxItems": 1000,
///          "minItems": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "paths"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "delete_untracked"
///        },
///        "paths": {
///          "type": "array",
///          "items": {
///            "type": "string",
///            "maxLength": 4096,
///            "minLength": 1
///          },
///          "maxItems": 1000,
///          "minItems": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "message"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "commit"
///        },
///        "message": {
///          "type": "string",
///          "maxLength": 10000,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "all"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "fetch"
///        },
///        "all": {
///          "default": false,
///          "type": "boolean"
///        },
///        "remote": {
///          "type": "string",
///          "maxLength": 512,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "pull"
///        },
///        "branch": {
///          "type": "string",
///          "maxLength": 512,
///          "minLength": 1
///        },
///        "remote": {
///          "type": "string",
///          "maxLength": 512,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "setUpstream"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "push"
///        },
///        "remote": {
///          "type": "string",
///          "maxLength": 512,
///          "minLength": 1
///        },
///        "setUpstream": {
///          "default": false,
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "name"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "branch_create"
///        },
///        "name": {
///          "type": "string",
///          "maxLength": 255,
///          "minLength": 1
///        },
///        "startPoint": {
///          "type": "string",
///          "maxLength": 512,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "name"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "branch_switch"
///        },
///        "name": {
///          "type": "string",
///          "maxLength": 255,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "name",
///        "remoteBranch"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "branch_track"
///        },
///        "name": {
///          "type": "string",
///          "maxLength": 255,
///          "minLength": 1
///        },
///        "remoteBranch": {
///          "type": "string",
///          "maxLength": 512,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "name"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "branch_delete"
///        },
///        "name": {
///          "type": "string",
///          "maxLength": 255,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "branch",
///        "reuseExistingBranch"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "workspace_create"
///        },
///        "branch": {
///          "type": "string",
///          "maxLength": 255,
///          "minLength": 1
///        },
///        "from": {
///          "type": "string",
///          "maxLength": 512,
///          "minLength": 1
///        },
///        "name": {
///          "type": "string",
///          "maxLength": 100,
///          "minLength": 1
///        },
///        "reuseExistingBranch": {
///          "default": false,
///          "type": "boolean"
///        },
///        "slug": {
///          "type": "string",
///          "maxLength": 60,
///          "minLength": 1,
///          "pattern": "^[a-z0-9][a-z0-9-]*$"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "repository"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "project_prepare"
///        },
///        "repository": {
///          "type": "object",
///          "required": [
///            "credential",
///            "name",
///            "slug",
///            "url"
///          ],
///          "properties": {
///            "credential": {
///              "default": "machine",
///              "type": "string",
///              "enum": [
///                "exeora",
///                "machine"
///              ]
///            },
///            "defaultBranch": {
///              "type": "string",
///              "maxLength": 255,
///              "minLength": 1
///            },
///            "name": {
///              "type": "string",
///              "maxLength": 100,
///              "minLength": 1
///            },
///            "slug": {
///              "type": "string",
///              "maxLength": 60,
///              "minLength": 1,
///              "pattern": "^[a-z0-9][a-z0-9-]*$"
///            },
///            "url": {
///              "type": "string",
///              "maxLength": 1000,
///              "minLength": 1
///            }
///          },
///          "additionalProperties": false
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "limit"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "log"
///        },
///        "cursor": {
///          "type": "string",
///          "maxLength": 64
///        },
///        "limit": {
///          "default": 30,
///          "type": "integer",
///          "maximum": 100.0,
///          "minimum": 1.0
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "oid"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "commit_detail"
///        },
///        "oid": {
///          "type": "string",
///          "pattern": "^[0-9a-f]{4,64}$"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "oid"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "commit_diff"
///        },
///        "oid": {
///          "type": "string",
///          "pattern": "^[0-9a-f]{4,64}$"
///        },
///        "path": {
///          "type": "string",
///          "maxLength": 4096,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "area"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "diff_all"
///        },
///        "area": {
///          "type": "string",
///          "enum": [
///            "working",
///            "staged"
///          ]
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "base"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "range_diff"
///        },
///        "base": {
///          "type": "string",
///          "maxLength": 512,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "staged_context"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "base"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "range_context"
///        },
///        "base": {
///          "type": "string",
///          "maxLength": 512,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "stash_list"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "amend"
///        },
///        "message": {
///          "type": "string",
///          "maxLength": 10000,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "includeUntracked"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "stash_push"
///        },
///        "includeUntracked": {
///          "default": true,
///          "type": "boolean"
///        },
///        "message": {
///          "type": "string",
///          "maxLength": 1000,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "index"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "stash_pop"
///        },
///        "index": {
///          "default": 0,
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": 0.0
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "index"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "stash_drop"
///        },
///        "index": {
///          "type": "integer",
///          "maximum": 9007199254740991.0,
///          "minimum": 0.0
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "sync"
///        },
///        "remote": {
///          "type": "string",
///          "maxLength": 512,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "discard_all"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "path",
///        "showIgnored"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "tree"
///        },
///        "path": {
///          "default": ".",
///          "type": "string",
///          "maxLength": 4096,
///          "minLength": 1
///        },
///        "showIgnored": {
///          "default": false,
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "encoding",
///        "path"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "file_read"
///        },
///        "encoding": {
///          "default": "text",
///          "type": "string",
///          "enum": [
///            "text",
///            "base64"
///          ]
///        },
///        "path": {
///          "type": "string",
///          "maxLength": 4096,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "content",
///        "create",
///        "path"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "file_write"
///        },
///        "content": {
///          "type": "string",
///          "maxLength": 1000000
///        },
///        "create": {
///          "default": true,
///          "type": "boolean"
///        },
///        "expectedToken": {
///          "type": "string",
///          "maxLength": 64
///        },
///        "path": {
///          "type": "string",
///          "maxLength": 4096,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "path",
///        "type"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "file_create"
///        },
///        "path": {
///          "type": "string",
///          "maxLength": 4096,
///          "minLength": 1
///        },
///        "type": {
///          "type": "string",
///          "enum": [
///            "file",
///            "directory"
///          ]
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "from",
///        "overwrite",
///        "to"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "file_rename"
///        },
///        "from": {
///          "type": "string",
///          "maxLength": 4096,
///          "minLength": 1
///        },
///        "overwrite": {
///          "default": false,
///          "type": "boolean"
///        },
///        "to": {
///          "type": "string",
///          "maxLength": 4096,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "overwrite",
///        "paths",
///        "to"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "file_move"
///        },
///        "overwrite": {
///          "default": false,
///          "type": "boolean"
///        },
///        "paths": {
///          "type": "array",
///          "items": {
///            "type": "string",
///            "maxLength": 4096,
///            "minLength": 1
///          },
///          "maxItems": 100,
///          "minItems": 1
///        },
///        "to": {
///          "type": "string",
///          "maxLength": 4096,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "paths"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "file_delete"
///        },
///        "paths": {
///          "type": "array",
///          "items": {
///            "type": "string",
///            "maxLength": 4096,
///            "minLength": 1
///          },
///          "maxItems": 100,
///          "minItems": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "path"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "file_duplicate"
///        },
///        "path": {
///          "type": "string",
///          "maxLength": 4096,
///          "minLength": 1
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "caseSensitive",
///        "includeIgnored",
///        "maxPerFile",
///        "maxResults",
///        "query",
///        "regex",
///        "wholeWord"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "search"
///        },
///        "caseSensitive": {
///          "default": false,
///          "type": "boolean"
///        },
///        "exclude": {
///          "type": "string",
///          "maxLength": 1000
///        },
///        "include": {
///          "type": "string",
///          "maxLength": 1000
///        },
///        "includeIgnored": {
///          "default": false,
///          "type": "boolean"
///        },
///        "maxPerFile": {
///          "default": 50,
///          "type": "integer",
///          "maximum": 100.0,
///          "minimum": 1.0
///        },
///        "maxResults": {
///          "default": 500,
///          "type": "integer",
///          "maximum": 2000.0,
///          "minimum": 1.0
///        },
///        "path": {
///          "type": "string",
///          "maxLength": 4096,
///          "minLength": 1
///        },
///        "query": {
///          "type": "string",
///          "maxLength": 1000,
///          "minLength": 1
///        },
///        "regex": {
///          "default": false,
///          "type": "boolean"
///        },
///        "wholeWord": {
///          "default": false,
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "caseSensitive",
///        "preserveCase",
///        "query",
///        "regex",
///        "replacement",
///        "targets",
///        "wholeWord"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "replace"
///        },
///        "caseSensitive": {
///          "default": false,
///          "type": "boolean"
///        },
///        "preserveCase": {
///          "default": false,
///          "type": "boolean"
///        },
///        "query": {
///          "type": "string",
///          "maxLength": 1000,
///          "minLength": 1
///        },
///        "regex": {
///          "default": false,
///          "type": "boolean"
///        },
///        "replacement": {
///          "type": "string",
///          "maxLength": 10000
///        },
///        "targets": {
///          "type": "array",
///          "items": {
///            "type": "object",
///            "required": [
///              "path",
///              "token"
///            ],
///            "properties": {
///              "lines": {
///                "type": "array",
///                "items": {
///                  "type": "integer",
///                  "maximum": 9007199254740991.0,
///                  "minimum": 1.0
///                },
///                "maxItems": 100
///              },
///              "path": {
///                "type": "string",
///                "maxLength": 4096,
///                "minLength": 1
///              },
///              "token": {
///                "type": "string",
///                "maxLength": 64
///              }
///            },
///            "additionalProperties": false
///          },
///          "maxItems": 500,
///          "minItems": 1
///        },
///        "wholeWord": {
///          "default": false,
///          "type": "boolean"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "chatgpt_status"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "mode"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "chatgpt_login_start"
///        },
///        "mode": {
///          "type": "string",
///          "enum": [
///            "new",
///            "reauth",
///            "enable_plan"
///          ]
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "chatgpt_login_cancel"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "chatgpt_logout"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "chatgpt_models"
///        }
///      },
///      "additionalProperties": false
///    },
///    {
///      "type": "object",
///      "required": [
///        "action",
///        "input",
///        "instructions"
///      ],
///      "properties": {
///        "action": {
///          "type": "string",
///          "const": "chatgpt_generate"
///        },
///        "input": {
///          "type": "string",
///          "maxLength": 220000
///        },
///        "instructions": {
///          "type": "string",
///          "maxLength": 4000
///        },
///        "model": {
///          "type": "string",
///          "maxLength": 128,
///          "minLength": 1,
///          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$"
///        }
///      },
///      "additionalProperties": false
///    }
///  ]
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(tag = "action", deny_unknown_fields)]
pub enum ExeoraProtocolTypesRelayMessageAction {
    #[serde(rename = "status")]
    Status,
    #[serde(rename = "diff")]
    Diff {
        area: ExeoraProtocolTypesRelayMessageActionArea,
        path: ExeoraProtocolTypesRelayMessageActionPath,
    },
    #[serde(rename = "unpublished")]
    Unpublished,
    #[serde(rename = "stage")]
    Stage {
        paths: ::std::vec::Vec<ExeoraProtocolTypesRelayMessageActionPathsItem>,
    },
    #[serde(rename = "unstage")]
    Unstage {
        paths: ::std::vec::Vec<ExeoraProtocolTypesRelayMessageActionPathsItem>,
    },
    #[serde(rename = "discard")]
    Discard {
        paths: ::std::vec::Vec<ExeoraProtocolTypesRelayMessageActionPathsItem>,
    },
    #[serde(rename = "delete_untracked")]
    DeleteUntracked {
        paths: ::std::vec::Vec<ExeoraProtocolTypesRelayMessageActionPathsItem>,
    },
    #[serde(rename = "commit")]
    Commit {
        message: ExeoraProtocolTypesRelayMessageActionMessage,
    },
    #[serde(rename = "fetch")]
    Fetch {
        all: bool,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        remote: ::std::option::Option<ExeoraProtocolTypesRelayMessageActionRemote>,
    },
    #[serde(rename = "pull")]
    Pull {
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        branch: ::std::option::Option<ExeoraProtocolTypesRelayMessageActionBranch>,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        remote: ::std::option::Option<ExeoraProtocolTypesRelayMessageActionRemote>,
    },
    #[serde(rename = "push")]
    Push {
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        remote: ::std::option::Option<ExeoraProtocolTypesRelayMessageActionRemote>,
        #[serde(rename = "setUpstream")]
        set_upstream: bool,
    },
    #[serde(rename = "branch_create")]
    BranchCreate {
        name: ExeoraProtocolTypesRelayMessageActionName,
        #[serde(
            rename = "startPoint",
            default,
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        start_point: ::std::option::Option<ExeoraProtocolTypesRelayMessageActionStartPoint>,
    },
    #[serde(rename = "branch_switch")]
    BranchSwitch {
        name: ExeoraProtocolTypesRelayMessageActionName,
    },
    #[serde(rename = "branch_track")]
    BranchTrack {
        name: ExeoraProtocolTypesRelayMessageActionName,
        #[serde(rename = "remoteBranch")]
        remote_branch: ExeoraProtocolTypesRelayMessageActionRemoteBranch,
    },
    #[serde(rename = "branch_delete")]
    BranchDelete {
        name: ExeoraProtocolTypesRelayMessageActionName,
    },
    #[serde(rename = "workspace_create")]
    WorkspaceCreate {
        branch: ExeoraProtocolTypesRelayMessageActionBranch,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        from: ::std::option::Option<ExeoraProtocolTypesRelayMessageActionFrom>,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        name: ::std::option::Option<ExeoraProtocolTypesRelayMessageActionName>,
        #[serde(rename = "reuseExistingBranch")]
        reuse_existing_branch: bool,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        slug: ::std::option::Option<ExeoraProtocolTypesRelayMessageActionSlug>,
    },
    #[serde(rename = "project_prepare")]
    ProjectPrepare {
        repository: ExeoraProtocolTypesRelayMessageActionRepository,
    },
    #[serde(rename = "log")]
    Log {
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        cursor: ::std::option::Option<ExeoraProtocolTypesRelayMessageActionCursor>,
        limit: ::std::num::NonZeroU64,
    },
    #[serde(rename = "commit_detail")]
    CommitDetail {
        oid: ExeoraProtocolTypesRelayMessageActionOid,
    },
    #[serde(rename = "commit_diff")]
    CommitDiff {
        oid: ExeoraProtocolTypesRelayMessageActionOid,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        path: ::std::option::Option<ExeoraProtocolTypesRelayMessageActionPath>,
    },
    #[serde(rename = "diff_all")]
    DiffAll {
        area: ExeoraProtocolTypesRelayMessageActionArea,
    },
    #[serde(rename = "range_diff")]
    RangeDiff {
        base: ExeoraProtocolTypesRelayMessageActionBase,
    },
    #[serde(rename = "staged_context")]
    StagedContext,
    #[serde(rename = "range_context")]
    RangeContext {
        base: ExeoraProtocolTypesRelayMessageActionBase,
    },
    #[serde(rename = "stash_list")]
    StashList,
    #[serde(rename = "amend")]
    Amend {
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        message: ::std::option::Option<ExeoraProtocolTypesRelayMessageActionMessage>,
    },
    #[serde(rename = "stash_push")]
    StashPush {
        #[serde(rename = "includeUntracked")]
        include_untracked: bool,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        message: ::std::option::Option<ExeoraProtocolTypesRelayMessageActionMessage>,
    },
    #[serde(rename = "stash_pop")]
    StashPop { index: i64 },
    #[serde(rename = "stash_drop")]
    StashDrop { index: i64 },
    #[serde(rename = "sync")]
    Sync {
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        remote: ::std::option::Option<ExeoraProtocolTypesRelayMessageActionRemote>,
    },
    #[serde(rename = "discard_all")]
    DiscardAll,
    #[serde(rename = "tree")]
    Tree {
        path: ExeoraProtocolTypesRelayMessageActionPath,
        #[serde(rename = "showIgnored")]
        show_ignored: bool,
    },
    #[serde(rename = "file_read")]
    FileRead {
        encoding: ExeoraProtocolTypesRelayMessageActionEncoding,
        path: ExeoraProtocolTypesRelayMessageActionPath,
    },
    #[serde(rename = "file_write")]
    FileWrite {
        content: ExeoraProtocolTypesRelayMessageActionContent,
        create: bool,
        #[serde(
            rename = "expectedToken",
            default,
            skip_serializing_if = "::std::option::Option::is_none"
        )]
        expected_token: ::std::option::Option<ExeoraProtocolTypesRelayMessageActionExpectedToken>,
        path: ExeoraProtocolTypesRelayMessageActionPath,
    },
    #[serde(rename = "file_create")]
    FileCreate {
        path: ExeoraProtocolTypesRelayMessageActionPath,
        #[serde(rename = "type")]
        type_: ExeoraProtocolTypesRelayMessageActionType,
    },
    #[serde(rename = "file_rename")]
    FileRename {
        from: ExeoraProtocolTypesRelayMessageActionFrom,
        overwrite: bool,
        to: ExeoraProtocolTypesRelayMessageActionTo,
    },
    #[serde(rename = "file_move")]
    FileMove {
        overwrite: bool,
        paths: ::std::vec::Vec<ExeoraProtocolTypesRelayMessageActionPathsItem>,
        to: ExeoraProtocolTypesRelayMessageActionTo,
    },
    #[serde(rename = "file_delete")]
    FileDelete {
        paths: ::std::vec::Vec<ExeoraProtocolTypesRelayMessageActionPathsItem>,
    },
    #[serde(rename = "file_duplicate")]
    FileDuplicate {
        path: ExeoraProtocolTypesRelayMessageActionPath,
    },
    #[serde(rename = "search")]
    Search {
        #[serde(rename = "caseSensitive")]
        case_sensitive: bool,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        exclude: ::std::option::Option<ExeoraProtocolTypesRelayMessageActionExclude>,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        include: ::std::option::Option<ExeoraProtocolTypesRelayMessageActionInclude>,
        #[serde(rename = "includeIgnored")]
        include_ignored: bool,
        #[serde(rename = "maxPerFile")]
        max_per_file: ::std::num::NonZeroU64,
        #[serde(rename = "maxResults")]
        max_results: ::std::num::NonZeroU64,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        path: ::std::option::Option<ExeoraProtocolTypesRelayMessageActionPath>,
        query: ExeoraProtocolTypesRelayMessageActionQuery,
        regex: bool,
        #[serde(rename = "wholeWord")]
        whole_word: bool,
    },
    #[serde(rename = "replace")]
    Replace {
        #[serde(rename = "caseSensitive")]
        case_sensitive: bool,
        #[serde(rename = "preserveCase")]
        preserve_case: bool,
        query: ExeoraProtocolTypesRelayMessageActionQuery,
        regex: bool,
        replacement: ExeoraProtocolTypesRelayMessageActionReplacement,
        targets: ::std::vec::Vec<ExeoraProtocolTypesRelayMessageActionTargetsItem>,
        #[serde(rename = "wholeWord")]
        whole_word: bool,
    },
    #[serde(rename = "chatgpt_status")]
    ChatgptStatus,
    #[serde(rename = "chatgpt_login_start")]
    ChatgptLoginStart {
        mode: ExeoraProtocolTypesRelayMessageActionMode,
    },
    #[serde(rename = "chatgpt_login_cancel")]
    ChatgptLoginCancel,
    #[serde(rename = "chatgpt_logout")]
    ChatgptLogout,
    #[serde(rename = "chatgpt_models")]
    ChatgptModels,
    #[serde(rename = "chatgpt_generate")]
    ChatgptGenerate {
        input: ExeoraProtocolTypesRelayMessageActionInput,
        instructions: ExeoraProtocolTypesRelayMessageActionInstructions,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        model: ::std::option::Option<ExeoraProtocolTypesRelayMessageActionModel>,
    },
}
///`ExeoraProtocolTypesRelayMessageActionArea`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "working",
///    "staged"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesRelayMessageActionArea {
    #[serde(rename = "working")]
    Working,
    #[serde(rename = "staged")]
    Staged,
}
impl ::std::fmt::Display for ExeoraProtocolTypesRelayMessageActionArea {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Working => f.write_str("working"),
            Self::Staged => f.write_str("staged"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionArea {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "working" => Ok(Self::Working),
            "staged" => Ok(Self::Staged),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionArea {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesRelayMessageActionArea {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessageActionArea {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesRelayMessageActionBase`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 512,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionBase(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionBase {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionBase> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageActionBase) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionBase {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 512usize {
            return Err("longer than 512 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionBase {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesRelayMessageActionBase {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessageActionBase {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionBase {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionBranch`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 512,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionBranch(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionBranch {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionBranch> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageActionBranch) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionBranch {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 512usize {
            return Err("longer than 512 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionBranch {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionBranch
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionBranch
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionBranch {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionContent`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 1000000
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionContent(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionContent {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionContent> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageActionContent) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionContent {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 1000000usize {
            return Err("longer than 1000000 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionContent {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionContent
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionContent
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionContent {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionCursor`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 64
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionCursor(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionCursor {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionCursor> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageActionCursor) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionCursor {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 64usize {
            return Err("longer than 64 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionCursor {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionCursor
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionCursor
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionCursor {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionEncoding`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "default": "text",
///  "type": "string",
///  "enum": [
///    "text",
///    "base64"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesRelayMessageActionEncoding {
    #[serde(rename = "text")]
    Text,
    #[serde(rename = "base64")]
    Base64,
}
impl ::std::fmt::Display for ExeoraProtocolTypesRelayMessageActionEncoding {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Text => f.write_str("text"),
            Self::Base64 => f.write_str("base64"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionEncoding {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "text" => Ok(Self::Text),
            "base64" => Ok(Self::Base64),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionEncoding {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionEncoding
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionEncoding
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::default::Default for ExeoraProtocolTypesRelayMessageActionEncoding {
    fn default() -> Self {
        ExeoraProtocolTypesRelayMessageActionEncoding::Text
    }
}
///`ExeoraProtocolTypesRelayMessageActionExclude`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 1000
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionExclude(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionExclude {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionExclude> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageActionExclude) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionExclude {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 1000usize {
            return Err("longer than 1000 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionExclude {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionExclude
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionExclude
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionExclude {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionExpectedToken`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 64
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionExpectedToken(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionExpectedToken {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionExpectedToken>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesRelayMessageActionExpectedToken) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionExpectedToken {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 64usize {
            return Err("longer than 64 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionExpectedToken {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionExpectedToken
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionExpectedToken
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionExpectedToken {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionFrom`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 512,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionFrom(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionFrom {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionFrom> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageActionFrom) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionFrom {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 512usize {
            return Err("longer than 512 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionFrom {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesRelayMessageActionFrom {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessageActionFrom {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionFrom {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionInclude`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 1000
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionInclude(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionInclude {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionInclude> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageActionInclude) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionInclude {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 1000usize {
            return Err("longer than 1000 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionInclude {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionInclude
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionInclude
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionInclude {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionInput`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 220000
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionInput(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionInput {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionInput> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageActionInput) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionInput {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 220000usize {
            return Err("longer than 220000 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionInput {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionInput
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessageActionInput {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionInput {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionInstructions`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 4000
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionInstructions(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionInstructions {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionInstructions>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesRelayMessageActionInstructions) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionInstructions {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 4000usize {
            return Err("longer than 4000 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionInstructions {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionInstructions
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionInstructions
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionInstructions {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionMessage`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 10000,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionMessage(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionMessage {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionMessage> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageActionMessage) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionMessage {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 10000usize {
            return Err("longer than 10000 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionMessage {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionMessage
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionMessage
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionMessage {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionMode`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "new",
///    "reauth",
///    "enable_plan"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesRelayMessageActionMode {
    #[serde(rename = "new")]
    New,
    #[serde(rename = "reauth")]
    Reauth,
    #[serde(rename = "enable_plan")]
    EnablePlan,
}
impl ::std::fmt::Display for ExeoraProtocolTypesRelayMessageActionMode {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::New => f.write_str("new"),
            Self::Reauth => f.write_str("reauth"),
            Self::EnablePlan => f.write_str("enable_plan"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionMode {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "new" => Ok(Self::New),
            "reauth" => Ok(Self::Reauth),
            "enable_plan" => Ok(Self::EnablePlan),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionMode {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesRelayMessageActionMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessageActionMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesRelayMessageActionModel`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 128,
///  "minLength": 1,
///  "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$"
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionModel(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionModel {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionModel> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageActionModel) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionModel {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 128usize {
            return Err("longer than 128 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| {
                ::regress::Regex::new("^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$").unwrap()
            });
        if PATTERN.find(value).is_none() {
            return Err("doesn't match pattern \"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$\"".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionModel {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionModel
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessageActionModel {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionModel {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionName`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 255,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionName(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionName> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageActionName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 255usize {
            return Err("longer than 255 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionName {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesRelayMessageActionName {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessageActionName {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionName {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionOid`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "pattern": "^[0-9a-f]{4,64}$"
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionOid(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionOid {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionOid> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageActionOid) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionOid {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| ::regress::Regex::new("^[0-9a-f]{4,64}$").unwrap());
        if PATTERN.find(value).is_none() {
            return Err("doesn't match pattern \"^[0-9a-f]{4,64}$\"".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionOid {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesRelayMessageActionOid {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessageActionOid {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionOid {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionPath`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 4096,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionPath(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionPath {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionPath> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageActionPath) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionPath {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 4096usize {
            return Err("longer than 4096 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionPath {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesRelayMessageActionPath {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessageActionPath {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionPath {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionPathsItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 4096,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionPathsItem(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionPathsItem {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionPathsItem>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesRelayMessageActionPathsItem) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionPathsItem {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 4096usize {
            return Err("longer than 4096 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionPathsItem {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionPathsItem
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionPathsItem
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionPathsItem {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionQuery`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 1000,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionQuery(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionQuery {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionQuery> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageActionQuery) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionQuery {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 1000usize {
            return Err("longer than 1000 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionQuery {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionQuery
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessageActionQuery {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionQuery {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionRemote`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 512,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionRemote(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionRemote {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionRemote> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageActionRemote) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionRemote {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 512usize {
            return Err("longer than 512 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionRemote {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionRemote
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionRemote
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionRemote {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionRemoteBranch`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 512,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionRemoteBranch(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionRemoteBranch {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionRemoteBranch>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesRelayMessageActionRemoteBranch) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionRemoteBranch {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 512usize {
            return Err("longer than 512 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionRemoteBranch {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionRemoteBranch
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionRemoteBranch
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionRemoteBranch {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionReplacement`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 10000
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionReplacement(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionReplacement {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionReplacement>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesRelayMessageActionReplacement) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionReplacement {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 10000usize {
            return Err("longer than 10000 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionReplacement {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionReplacement
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionReplacement
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionReplacement {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionRepository`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "credential",
///    "name",
///    "slug",
///    "url"
///  ],
///  "properties": {
///    "credential": {
///      "default": "machine",
///      "type": "string",
///      "enum": [
///        "exeora",
///        "machine"
///      ]
///    },
///    "defaultBranch": {
///      "type": "string",
///      "maxLength": 255,
///      "minLength": 1
///    },
///    "name": {
///      "type": "string",
///      "maxLength": 100,
///      "minLength": 1
///    },
///    "slug": {
///      "type": "string",
///      "maxLength": 60,
///      "minLength": 1,
///      "pattern": "^[a-z0-9][a-z0-9-]*$"
///    },
///    "url": {
///      "type": "string",
///      "maxLength": 1000,
///      "minLength": 1
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesRelayMessageActionRepository {
    pub credential: ExeoraProtocolTypesRelayMessageActionRepositoryCredential,
    #[serde(
        rename = "defaultBranch",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub default_branch:
        ::std::option::Option<ExeoraProtocolTypesRelayMessageActionRepositoryDefaultBranch>,
    pub name: ExeoraProtocolTypesRelayMessageActionRepositoryName,
    pub slug: ExeoraProtocolTypesRelayMessageActionRepositorySlug,
    pub url: ExeoraProtocolTypesRelayMessageActionRepositoryUrl,
}
///`ExeoraProtocolTypesRelayMessageActionRepositoryCredential`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "default": "machine",
///  "type": "string",
///  "enum": [
///    "exeora",
///    "machine"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesRelayMessageActionRepositoryCredential {
    #[serde(rename = "exeora")]
    Exeora,
    #[serde(rename = "machine")]
    Machine,
}
impl ::std::fmt::Display for ExeoraProtocolTypesRelayMessageActionRepositoryCredential {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Exeora => f.write_str("exeora"),
            Self::Machine => f.write_str("machine"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionRepositoryCredential {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "exeora" => Ok(Self::Exeora),
            "machine" => Ok(Self::Machine),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionRepositoryCredential {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionRepositoryCredential
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionRepositoryCredential
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::default::Default for ExeoraProtocolTypesRelayMessageActionRepositoryCredential {
    fn default() -> Self {
        ExeoraProtocolTypesRelayMessageActionRepositoryCredential::Machine
    }
}
///`ExeoraProtocolTypesRelayMessageActionRepositoryDefaultBranch`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 255,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionRepositoryDefaultBranch(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionRepositoryDefaultBranch {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionRepositoryDefaultBranch>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesRelayMessageActionRepositoryDefaultBranch) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionRepositoryDefaultBranch {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 255usize {
            return Err("longer than 255 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesRelayMessageActionRepositoryDefaultBranch
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionRepositoryDefaultBranch
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionRepositoryDefaultBranch
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesRelayMessageActionRepositoryDefaultBranch
{
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionRepositoryName`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 100,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionRepositoryName(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionRepositoryName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionRepositoryName>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesRelayMessageActionRepositoryName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionRepositoryName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 100usize {
            return Err("longer than 100 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionRepositoryName {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionRepositoryName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionRepositoryName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionRepositoryName {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionRepositorySlug`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 60,
///  "minLength": 1,
///  "pattern": "^[a-z0-9][a-z0-9-]*$"
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionRepositorySlug(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionRepositorySlug {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionRepositorySlug>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesRelayMessageActionRepositorySlug) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionRepositorySlug {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 60usize {
            return Err("longer than 60 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| ::regress::Regex::new("^[a-z0-9][a-z0-9-]*$").unwrap());
        if PATTERN.find(value).is_none() {
            return Err("doesn't match pattern \"^[a-z0-9][a-z0-9-]*$\"".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionRepositorySlug {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionRepositorySlug
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionRepositorySlug
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionRepositorySlug {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionRepositoryUrl`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 1000,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionRepositoryUrl(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionRepositoryUrl {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionRepositoryUrl>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesRelayMessageActionRepositoryUrl) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionRepositoryUrl {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 1000usize {
            return Err("longer than 1000 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionRepositoryUrl {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionRepositoryUrl
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionRepositoryUrl
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionRepositoryUrl {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionSlug`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 60,
///  "minLength": 1,
///  "pattern": "^[a-z0-9][a-z0-9-]*$"
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionSlug(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionSlug {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionSlug> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageActionSlug) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionSlug {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 60usize {
            return Err("longer than 60 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| ::regress::Regex::new("^[a-z0-9][a-z0-9-]*$").unwrap());
        if PATTERN.find(value).is_none() {
            return Err("doesn't match pattern \"^[a-z0-9][a-z0-9-]*$\"".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionSlug {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesRelayMessageActionSlug {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessageActionSlug {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionSlug {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionStartPoint`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 512,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionStartPoint(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionStartPoint {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionStartPoint>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesRelayMessageActionStartPoint) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionStartPoint {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 512usize {
            return Err("longer than 512 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionStartPoint {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionStartPoint
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionStartPoint
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionStartPoint {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionTargetsItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "path",
///    "token"
///  ],
///  "properties": {
///    "lines": {
///      "type": "array",
///      "items": {
///        "type": "integer",
///        "maximum": 9007199254740991.0,
///        "minimum": 1.0
///      },
///      "maxItems": 100
///    },
///    "path": {
///      "type": "string",
///      "maxLength": 4096,
///      "minLength": 1
///    },
///    "token": {
///      "type": "string",
///      "maxLength": 64
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesRelayMessageActionTargetsItem {
    #[serde(default, skip_serializing_if = "::std::vec::Vec::is_empty")]
    pub lines: ::std::vec::Vec<::std::num::NonZeroU64>,
    pub path: ExeoraProtocolTypesRelayMessageActionTargetsItemPath,
    pub token: ExeoraProtocolTypesRelayMessageActionTargetsItemToken,
}
///`ExeoraProtocolTypesRelayMessageActionTargetsItemPath`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 4096,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionTargetsItemPath(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionTargetsItemPath {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionTargetsItemPath>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesRelayMessageActionTargetsItemPath) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionTargetsItemPath {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 4096usize {
            return Err("longer than 4096 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionTargetsItemPath {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionTargetsItemPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionTargetsItemPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionTargetsItemPath {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionTargetsItemToken`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 64
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionTargetsItemToken(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionTargetsItemToken {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionTargetsItemToken>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesRelayMessageActionTargetsItemToken) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionTargetsItemToken {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 64usize {
            return Err("longer than 64 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionTargetsItemToken {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionTargetsItemToken
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageActionTargetsItemToken
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionTargetsItemToken {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionTo`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 4096,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageActionTo(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageActionTo {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageActionTo> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageActionTo) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionTo {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 4096usize {
            return Err("longer than 4096 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionTo {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesRelayMessageActionTo {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessageActionTo {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageActionTo {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageActionType`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "file",
///    "directory"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesRelayMessageActionType {
    #[serde(rename = "file")]
    File,
    #[serde(rename = "directory")]
    Directory,
}
impl ::std::fmt::Display for ExeoraProtocolTypesRelayMessageActionType {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::File => f.write_str("file"),
            Self::Directory => f.write_str("directory"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageActionType {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "file" => Ok(Self::File),
            "directory" => Ok(Self::Directory),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageActionType {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesRelayMessageActionType {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessageActionType {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesRelayMessageClient`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "properties": {
///    "id": {
///      "type": "string"
///    },
///    "name": {
///      "type": "string"
///    },
///    "version": {
///      "type": "string"
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesRelayMessageClient {
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub id: ::std::option::Option<::std::string::String>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub name: ::std::option::Option<::std::string::String>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub version: ::std::option::Option<::std::string::String>,
}
impl ::std::default::Default for ExeoraProtocolTypesRelayMessageClient {
    fn default() -> Self {
        Self {
            id: Default::default(),
            name: Default::default(),
            version: Default::default(),
        }
    }
}
///`ExeoraProtocolTypesRelayMessageCloudHooks`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "repository",
///    "scripts"
///  ],
///  "properties": {
///    "repository": {
///      "default": true,
///      "type": "boolean"
///    },
///    "scripts": {
///      "anyOf": [
///        {
///          "type": "object",
///          "required": [
///            "install",
///            "resume"
///          ],
///          "properties": {
///            "install": {
///              "anyOf": [
///                {
///                  "type": "string",
///                  "maxLength": 16384
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            },
///            "resume": {
///              "anyOf": [
///                {
///                  "type": "string",
///                  "maxLength": 16384
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "null"
///        }
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesRelayMessageCloudHooks {
    pub repository: bool,
    pub scripts: ::std::option::Option<ExeoraProtocolTypesRelayMessageCloudHooksScripts>,
}
///`ExeoraProtocolTypesRelayMessageCloudHooksScripts`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "install",
///    "resume"
///  ],
///  "properties": {
///    "install": {
///      "anyOf": [
///        {
///          "type": "string",
///          "maxLength": 16384
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "resume": {
///      "anyOf": [
///        {
///          "type": "string",
///          "maxLength": 16384
///        },
///        {
///          "type": "null"
///        }
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesRelayMessageCloudHooksScripts {
    pub install: ::std::option::Option<ExeoraProtocolTypesRelayMessageCloudHooksScriptsInstall>,
    pub resume: ::std::option::Option<ExeoraProtocolTypesRelayMessageCloudHooksScriptsResume>,
}
///`ExeoraProtocolTypesRelayMessageCloudHooksScriptsInstall`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 16384
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageCloudHooksScriptsInstall(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageCloudHooksScriptsInstall {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageCloudHooksScriptsInstall>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesRelayMessageCloudHooksScriptsInstall) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageCloudHooksScriptsInstall {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 16384usize {
            return Err("longer than 16384 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageCloudHooksScriptsInstall {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageCloudHooksScriptsInstall
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageCloudHooksScriptsInstall
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageCloudHooksScriptsInstall {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageCloudHooksScriptsResume`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 16384
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageCloudHooksScriptsResume(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageCloudHooksScriptsResume {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageCloudHooksScriptsResume>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesRelayMessageCloudHooksScriptsResume) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageCloudHooksScriptsResume {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 16384usize {
            return Err("longer than 16384 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageCloudHooksScriptsResume {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageCloudHooksScriptsResume
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageCloudHooksScriptsResume
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageCloudHooksScriptsResume {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageConfig`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "repository",
///    "scripts"
///  ],
///  "properties": {
///    "repository": {
///      "default": true,
///      "type": "boolean"
///    },
///    "scripts": {
///      "anyOf": [
///        {
///          "type": "object",
///          "required": [
///            "install",
///            "resume"
///          ],
///          "properties": {
///            "install": {
///              "anyOf": [
///                {
///                  "type": "string",
///                  "maxLength": 16384
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            },
///            "resume": {
///              "anyOf": [
///                {
///                  "type": "string",
///                  "maxLength": 16384
///                },
///                {
///                  "type": "null"
///                }
///              ]
///            }
///          },
///          "additionalProperties": false
///        },
///        {
///          "type": "null"
///        }
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesRelayMessageConfig {
    pub repository: bool,
    pub scripts: ::std::option::Option<ExeoraProtocolTypesRelayMessageConfigScripts>,
}
///`ExeoraProtocolTypesRelayMessageConfigScripts`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "install",
///    "resume"
///  ],
///  "properties": {
///    "install": {
///      "anyOf": [
///        {
///          "type": "string",
///          "maxLength": 16384
///        },
///        {
///          "type": "null"
///        }
///      ]
///    },
///    "resume": {
///      "anyOf": [
///        {
///          "type": "string",
///          "maxLength": 16384
///        },
///        {
///          "type": "null"
///        }
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesRelayMessageConfigScripts {
    pub install: ::std::option::Option<ExeoraProtocolTypesRelayMessageConfigScriptsInstall>,
    pub resume: ::std::option::Option<ExeoraProtocolTypesRelayMessageConfigScriptsResume>,
}
///`ExeoraProtocolTypesRelayMessageConfigScriptsInstall`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 16384
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageConfigScriptsInstall(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageConfigScriptsInstall {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageConfigScriptsInstall>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesRelayMessageConfigScriptsInstall) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageConfigScriptsInstall {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 16384usize {
            return Err("longer than 16384 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageConfigScriptsInstall {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageConfigScriptsInstall
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageConfigScriptsInstall
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageConfigScriptsInstall {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageConfigScriptsResume`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 16384
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageConfigScriptsResume(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageConfigScriptsResume {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageConfigScriptsResume>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesRelayMessageConfigScriptsResume) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageConfigScriptsResume {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 16384usize {
            return Err("longer than 16384 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageConfigScriptsResume {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessageConfigScriptsResume
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessageConfigScriptsResume
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageConfigScriptsResume {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageData`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 128000
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageData(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageData {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageData> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageData) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageData {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 128000usize {
            return Err("longer than 128000 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageData {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesRelayMessageData {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessageData {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageData {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageHook`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "install",
///    "resume"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesRelayMessageHook {
    #[serde(rename = "install")]
    Install,
    #[serde(rename = "resume")]
    Resume,
}
impl ::std::fmt::Display for ExeoraProtocolTypesRelayMessageHook {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Install => f.write_str("install"),
            Self::Resume => f.write_str("resume"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageHook {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "install" => Ok(Self::Install),
            "resume" => Ok(Self::Resume),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageHook {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesRelayMessageHook {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessageHook {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesRelayMessagePolicy`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "allow",
///    "approve",
///    "deny",
///    "mode",
///    "shell",
///    "tools"
///  ],
///  "properties": {
///    "allow": {
///      "default": [],
///      "type": "array",
///      "items": {
///        "type": "string"
///      }
///    },
///    "approve": {
///      "default": false,
///      "type": "boolean"
///    },
///    "deny": {
///      "default": [],
///      "type": "array",
///      "items": {
///        "type": "string"
///      }
///    },
///    "mode": {
///      "type": "string",
///      "enum": [
///        "allow_all",
///        "allow_list",
///        "read_only"
///      ]
///    },
///    "shell": {
///      "default": false,
///      "type": "boolean"
///    },
///    "tools": {
///      "default": null,
///      "anyOf": [
///        {
///          "type": "array",
///          "items": {
///            "type": "string",
///            "enum": [
///              "read_file",
///              "list_files",
///              "grep",
///              "edit_file",
///              "write_file",
///              "apply_patch",
///              "list_git_workspaces",
///              "create_workspace",
///              "attach_workspace",
///              "detach_workspace",
///              "remove_workspace",
///              "run_command",
///              "start_command",
///              "get_command_output",
///              "send_command_input",
///              "kill_command",
///              "list_skills"
///            ]
///          }
///        },
///        {
///          "type": "null"
///        }
///      ]
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesRelayMessagePolicy {
    pub allow: ::std::vec::Vec<::std::string::String>,
    pub approve: bool,
    pub deny: ::std::vec::Vec<::std::string::String>,
    pub mode: ExeoraProtocolTypesRelayMessagePolicyMode,
    pub shell: bool,
    pub tools:
        ::std::option::Option<::std::vec::Vec<ExeoraProtocolTypesRelayMessagePolicyToolsItem>>,
}
///`ExeoraProtocolTypesRelayMessagePolicyMode`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "allow_all",
///    "allow_list",
///    "read_only"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesRelayMessagePolicyMode {
    #[serde(rename = "allow_all")]
    AllowAll,
    #[serde(rename = "allow_list")]
    AllowList,
    #[serde(rename = "read_only")]
    ReadOnly,
}
impl ::std::fmt::Display for ExeoraProtocolTypesRelayMessagePolicyMode {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::AllowAll => f.write_str("allow_all"),
            Self::AllowList => f.write_str("allow_list"),
            Self::ReadOnly => f.write_str("read_only"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessagePolicyMode {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "allow_all" => Ok(Self::AllowAll),
            "allow_list" => Ok(Self::AllowList),
            "read_only" => Ok(Self::ReadOnly),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessagePolicyMode {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesRelayMessagePolicyMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessagePolicyMode {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesRelayMessagePolicyToolsItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "read_file",
///    "list_files",
///    "grep",
///    "edit_file",
///    "write_file",
///    "apply_patch",
///    "list_git_workspaces",
///    "create_workspace",
///    "attach_workspace",
///    "detach_workspace",
///    "remove_workspace",
///    "run_command",
///    "start_command",
///    "get_command_output",
///    "send_command_input",
///    "kill_command",
///    "list_skills"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesRelayMessagePolicyToolsItem {
    #[serde(rename = "read_file")]
    ReadFile,
    #[serde(rename = "list_files")]
    ListFiles,
    #[serde(rename = "grep")]
    Grep,
    #[serde(rename = "edit_file")]
    EditFile,
    #[serde(rename = "write_file")]
    WriteFile,
    #[serde(rename = "apply_patch")]
    ApplyPatch,
    #[serde(rename = "list_git_workspaces")]
    ListGitWorkspaces,
    #[serde(rename = "create_workspace")]
    CreateWorkspace,
    #[serde(rename = "attach_workspace")]
    AttachWorkspace,
    #[serde(rename = "detach_workspace")]
    DetachWorkspace,
    #[serde(rename = "remove_workspace")]
    RemoveWorkspace,
    #[serde(rename = "run_command")]
    RunCommand,
    #[serde(rename = "start_command")]
    StartCommand,
    #[serde(rename = "get_command_output")]
    GetCommandOutput,
    #[serde(rename = "send_command_input")]
    SendCommandInput,
    #[serde(rename = "kill_command")]
    KillCommand,
    #[serde(rename = "list_skills")]
    ListSkills,
}
impl ::std::fmt::Display for ExeoraProtocolTypesRelayMessagePolicyToolsItem {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::ReadFile => f.write_str("read_file"),
            Self::ListFiles => f.write_str("list_files"),
            Self::Grep => f.write_str("grep"),
            Self::EditFile => f.write_str("edit_file"),
            Self::WriteFile => f.write_str("write_file"),
            Self::ApplyPatch => f.write_str("apply_patch"),
            Self::ListGitWorkspaces => f.write_str("list_git_workspaces"),
            Self::CreateWorkspace => f.write_str("create_workspace"),
            Self::AttachWorkspace => f.write_str("attach_workspace"),
            Self::DetachWorkspace => f.write_str("detach_workspace"),
            Self::RemoveWorkspace => f.write_str("remove_workspace"),
            Self::RunCommand => f.write_str("run_command"),
            Self::StartCommand => f.write_str("start_command"),
            Self::GetCommandOutput => f.write_str("get_command_output"),
            Self::SendCommandInput => f.write_str("send_command_input"),
            Self::KillCommand => f.write_str("kill_command"),
            Self::ListSkills => f.write_str("list_skills"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessagePolicyToolsItem {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "read_file" => Ok(Self::ReadFile),
            "list_files" => Ok(Self::ListFiles),
            "grep" => Ok(Self::Grep),
            "edit_file" => Ok(Self::EditFile),
            "write_file" => Ok(Self::WriteFile),
            "apply_patch" => Ok(Self::ApplyPatch),
            "list_git_workspaces" => Ok(Self::ListGitWorkspaces),
            "create_workspace" => Ok(Self::CreateWorkspace),
            "attach_workspace" => Ok(Self::AttachWorkspace),
            "detach_workspace" => Ok(Self::DetachWorkspace),
            "remove_workspace" => Ok(Self::RemoveWorkspace),
            "run_command" => Ok(Self::RunCommand),
            "start_command" => Ok(Self::StartCommand),
            "get_command_output" => Ok(Self::GetCommandOutput),
            "send_command_input" => Ok(Self::SendCommandInput),
            "kill_command" => Ok(Self::KillCommand),
            "list_skills" => Ok(Self::ListSkills),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessagePolicyToolsItem {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesRelayMessagePolicyToolsItem
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesRelayMessagePolicyToolsItem
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesRelayMessageServer`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 64,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageServer(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageServer {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageServer> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageServer) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageServer {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 64usize {
            return Err("longer than 64 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageServer {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesRelayMessageServer {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessageServer {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageServer {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageSessionId`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "maxLength": 128,
///  "minLength": 1
///}
/// ```
/// </details>
#[derive(::serde::Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ExeoraProtocolTypesRelayMessageSessionId(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesRelayMessageSessionId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesRelayMessageSessionId> for ::std::string::String {
    fn from(value: ExeoraProtocolTypesRelayMessageSessionId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageSessionId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 128usize {
            return Err("longer than 128 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageSessionId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesRelayMessageSessionId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessageSessionId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesRelayMessageSessionId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
///`ExeoraProtocolTypesRelayMessageTool`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "string",
///  "enum": [
///    "read_file",
///    "list_files",
///    "grep",
///    "edit_file",
///    "write_file",
///    "apply_patch",
///    "list_git_workspaces",
///    "create_workspace",
///    "attach_workspace",
///    "detach_workspace",
///    "remove_workspace",
///    "run_command",
///    "start_command",
///    "get_command_output",
///    "send_command_input",
///    "kill_command",
///    "list_skills"
///  ]
///}
/// ```
/// </details>
#[derive(
    ::serde::Deserialize,
    ::serde::Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ExeoraProtocolTypesRelayMessageTool {
    #[serde(rename = "read_file")]
    ReadFile,
    #[serde(rename = "list_files")]
    ListFiles,
    #[serde(rename = "grep")]
    Grep,
    #[serde(rename = "edit_file")]
    EditFile,
    #[serde(rename = "write_file")]
    WriteFile,
    #[serde(rename = "apply_patch")]
    ApplyPatch,
    #[serde(rename = "list_git_workspaces")]
    ListGitWorkspaces,
    #[serde(rename = "create_workspace")]
    CreateWorkspace,
    #[serde(rename = "attach_workspace")]
    AttachWorkspace,
    #[serde(rename = "detach_workspace")]
    DetachWorkspace,
    #[serde(rename = "remove_workspace")]
    RemoveWorkspace,
    #[serde(rename = "run_command")]
    RunCommand,
    #[serde(rename = "start_command")]
    StartCommand,
    #[serde(rename = "get_command_output")]
    GetCommandOutput,
    #[serde(rename = "send_command_input")]
    SendCommandInput,
    #[serde(rename = "kill_command")]
    KillCommand,
    #[serde(rename = "list_skills")]
    ListSkills,
}
impl ::std::fmt::Display for ExeoraProtocolTypesRelayMessageTool {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::ReadFile => f.write_str("read_file"),
            Self::ListFiles => f.write_str("list_files"),
            Self::Grep => f.write_str("grep"),
            Self::EditFile => f.write_str("edit_file"),
            Self::WriteFile => f.write_str("write_file"),
            Self::ApplyPatch => f.write_str("apply_patch"),
            Self::ListGitWorkspaces => f.write_str("list_git_workspaces"),
            Self::CreateWorkspace => f.write_str("create_workspace"),
            Self::AttachWorkspace => f.write_str("attach_workspace"),
            Self::DetachWorkspace => f.write_str("detach_workspace"),
            Self::RemoveWorkspace => f.write_str("remove_workspace"),
            Self::RunCommand => f.write_str("run_command"),
            Self::StartCommand => f.write_str("start_command"),
            Self::GetCommandOutput => f.write_str("get_command_output"),
            Self::SendCommandInput => f.write_str("send_command_input"),
            Self::KillCommand => f.write_str("kill_command"),
            Self::ListSkills => f.write_str("list_skills"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesRelayMessageTool {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "read_file" => Ok(Self::ReadFile),
            "list_files" => Ok(Self::ListFiles),
            "grep" => Ok(Self::Grep),
            "edit_file" => Ok(Self::EditFile),
            "write_file" => Ok(Self::WriteFile),
            "apply_patch" => Ok(Self::ApplyPatch),
            "list_git_workspaces" => Ok(Self::ListGitWorkspaces),
            "create_workspace" => Ok(Self::CreateWorkspace),
            "attach_workspace" => Ok(Self::AttachWorkspace),
            "detach_workspace" => Ok(Self::DetachWorkspace),
            "remove_workspace" => Ok(Self::RemoveWorkspace),
            "run_command" => Ok(Self::RunCommand),
            "start_command" => Ok(Self::StartCommand),
            "get_command_output" => Ok(Self::GetCommandOutput),
            "send_command_input" => Ok(Self::SendCommandInput),
            "kill_command" => Ok(Self::KillCommand),
            "list_skills" => Ok(Self::ListSkills),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesRelayMessageTool {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ExeoraProtocolTypesRelayMessageTool {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ExeoraProtocolTypesRelayMessageTool {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
