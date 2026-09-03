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
///    "commandPolicy",
///    "executorMessage",
///    "localCommandPolicy",
///    "relayMessage"
///  ],
///  "properties": {
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
///                    "value": {
///                      "anyOf": [
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
///                                  "current",
///                                  "name",
///                                  "remote",
///                                  "shortOid",
///                                  "upstream"
///                                ],
///                                "properties": {
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
///                                    "type": "string",
///                                    "maxLength": 4096,
///                                    "minLength": 1
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
///                                      "current",
///                                      "name",
///                                      "remote",
///                                      "shortOid",
///                                      "upstream"
///                                    ],
///                                    "properties": {
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
///                                        "type": "string",
///                                        "maxLength": 4096,
///                                        "minLength": 1
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
    #[serde(rename = "commandPolicy")]
    pub command_policy: ExeoraProtocolTypesCommandPolicy,
    #[serde(rename = "executorMessage")]
    pub executor_message: ExeoraProtocolTypesExecutorMessage,
    #[serde(rename = "localCommandPolicy")]
    pub local_command_policy: ExeoraProtocolTypesLocalCommandPolicy,
    #[serde(rename = "relayMessage")]
    pub relay_message: ExeoraProtocolTypesRelayMessage,
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
///                "value": {
///                  "anyOf": [
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
///                              "current",
///                              "name",
///                              "remote",
///                              "shortOid",
///                              "upstream"
///                            ],
///                            "properties": {
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
///                                "type": "string",
///                                "maxLength": 4096,
///                                "minLength": 1
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
///                                  "current",
///                                  "name",
///                                  "remote",
///                                  "shortOid",
///                                  "upstream"
///                                ],
///                                "properties": {
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
///                                    "type": "string",
///                                    "maxLength": 4096,
///                                    "minLength": 1
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
    #[serde(rename = "tool.result")]
    ToolResult {
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
///  "anyOf": [
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
///              "current",
///              "name",
///              "remote",
///              "shortOid",
///              "upstream"
///            ],
///            "properties": {
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
///                "type": "string",
///                "maxLength": 4096,
///                "minLength": 1
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
///                  "current",
///                  "name",
///                  "remote",
///                  "shortOid",
///                  "upstream"
///                ],
///                "properties": {
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
///                    "type": "string",
///                    "maxLength": 4096,
///                    "minLength": 1
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
///    }
///  ]
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0Value {
    #[serde(rename = "status")]
    Status {
        ahead: i64,
        behind: i64,
        branches:
            ::std::vec::Vec<ExeoraProtocolTypesExecutorMessageResultVariant0ValueBranchesItem>,
        files: ::std::vec::Vec<ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItem>,
        #[serde(rename = "gitWorkspaces")]
        git_workspaces:
            ::std::vec::Vec<ExeoraProtocolTypesExecutorMessageResultVariant0ValueGitWorkspacesItem>,
        head: ::std::option::Option<::std::string::String>,
        oid: ::std::option::Option<::std::string::String>,
        operation:
            ::std::option::Option<ExeoraProtocolTypesExecutorMessageResultVariant0ValueOperation>,
        remotes: ::std::vec::Vec<::std::string::String>,
        repository: bool,
        upstream: ::std::option::Option<::std::string::String>,
    },
    #[serde(rename = "diff")]
    Diff {
        area: ExeoraProtocolTypesExecutorMessageResultVariant0ValueArea,
        binary: bool,
        patch: ::std::string::String,
        path: ExeoraProtocolTypesExecutorMessageResultVariant0ValuePath,
        truncated: bool,
    },
    #[serde(rename = "mutation")]
    Mutation {
        status: ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatus,
        stderr: ::std::string::String,
        stdout: ::std::string::String,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        workspace:
            ::std::option::Option<ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspace>,
    },
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueArea`
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
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueArea {
    #[serde(rename = "working")]
    Working,
    #[serde(rename = "staged")]
    Staged,
}
impl ::std::fmt::Display for ExeoraProtocolTypesExecutorMessageResultVariant0ValueArea {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Working => f.write_str("working"),
            Self::Staged => f.write_str("staged"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueArea {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "working" => Ok(Self::Working),
            "staged" => Ok(Self::Staged),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageResultVariant0ValueArea {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueArea
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueArea
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueBranchesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "current",
///    "name",
///    "remote",
///    "shortOid",
///    "upstream"
///  ],
///  "properties": {
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueBranchesItem {
    pub current: bool,
    pub name: ::std::string::String,
    pub remote: bool,
    #[serde(rename = "shortOid")]
    pub short_oid: ::std::string::String,
    pub upstream: ::std::option::Option<::std::string::String>,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItem`
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
///      "type": "string",
///      "maxLength": 4096,
///      "minLength": 1
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItem {
    pub index: ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemIndex,
    pub kind: ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemKind,
    #[serde(
        rename = "originalPath",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub original_path: ::std::option::Option<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemOriginalPath,
    >,
    pub path: ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemPath,
    pub submodule: bool,
    pub worktree: ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemWorktree,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemIndex`
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemIndex(
    ::std::string::String,
);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemIndex {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemIndex>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemIndex) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemIndex {
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
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemIndex
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemIndex
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemIndex
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemIndex
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
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemKind`
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
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemKind {
    #[serde(rename = "tracked")]
    Tracked,
    #[serde(rename = "untracked")]
    Untracked,
    #[serde(rename = "conflict")]
    Conflict,
}
impl ::std::fmt::Display for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemKind {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Tracked => f.write_str("tracked"),
            Self::Untracked => f.write_str("untracked"),
            Self::Conflict => f.write_str("conflict"),
        }
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemKind {
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
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemKind
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemKind
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemKind
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemOriginalPath`
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemOriginalPath(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemOriginalPath
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemOriginalPath>
    for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemOriginalPath,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemOriginalPath
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
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemOriginalPath
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemOriginalPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemOriginalPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemOriginalPath
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
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemPath`
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemPath(
    ::std::string::String,
);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemPath {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemPath>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemPath) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemPath {
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
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemPath
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemPath
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
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemWorktree`
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemWorktree(
    ::std::string::String,
);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemWorktree {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemWorktree>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemWorktree) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemWorktree
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
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemWorktree
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemWorktree
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemWorktree
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueFilesItemWorktree
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
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueGitWorkspacesItem`
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueGitWorkspacesItem {
    pub branch: ::std::option::Option<::std::string::String>,
    pub path: ::std::string::String,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueOperation`
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
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueOperation {
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
impl ::std::fmt::Display for ExeoraProtocolTypesExecutorMessageResultVariant0ValueOperation {
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
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueOperation {
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
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueOperation
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueOperation
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueOperation
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValuePath`
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValuePath(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageResultVariant0ValuePath {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValuePath>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageResultVariant0ValuePath) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValuePath {
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
impl ::std::convert::TryFrom<&str> for ExeoraProtocolTypesExecutorMessageResultVariant0ValuePath {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValuePath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValuePath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ExeoraProtocolTypesExecutorMessageResultVariant0ValuePath {
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
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatus`
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
///          "current",
///          "name",
///          "remote",
///          "shortOid",
///          "upstream"
///        ],
///        "properties": {
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
///            "type": "string",
///            "maxLength": 4096,
///            "minLength": 1
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatus {
    pub ahead: i64,
    pub behind: i64,
    pub branches:
        ::std::vec::Vec<ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusBranchesItem>,
    pub files:
        ::std::vec::Vec<ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItem>,
    #[serde(rename = "gitWorkspaces")]
    pub git_workspaces: ::std::vec::Vec<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusGitWorkspacesItem,
    >,
    pub head: ::std::option::Option<::std::string::String>,
    pub kind: ::std::string::String,
    pub oid: ::std::option::Option<::std::string::String>,
    pub operation:
        ::std::option::Option<ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusOperation>,
    pub remotes: ::std::vec::Vec<::std::string::String>,
    pub repository: bool,
    pub upstream: ::std::option::Option<::std::string::String>,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusBranchesItem`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "required": [
///    "current",
///    "name",
///    "remote",
///    "shortOid",
///    "upstream"
///  ],
///  "properties": {
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusBranchesItem {
    pub current: bool,
    pub name: ::std::string::String,
    pub remote: bool,
    #[serde(rename = "shortOid")]
    pub short_oid: ::std::string::String,
    pub upstream: ::std::option::Option<::std::string::String>,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItem`
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
///      "type": "string",
///      "maxLength": 4096,
///      "minLength": 1
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItem {
    pub index: ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemIndex,
    pub kind: ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemKind,
    #[serde(
        rename = "originalPath",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub original_path: ::std::option::Option<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemOriginalPath,
    >,
    pub path: ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemPath,
    pub submodule: bool,
    pub worktree: ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemWorktree,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemIndex`
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemIndex(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemIndex
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemIndex>
    for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemIndex,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemIndex
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
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemIndex
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemIndex
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemIndex
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemIndex
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
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemKind`
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
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemKind {
    #[serde(rename = "tracked")]
    Tracked,
    #[serde(rename = "untracked")]
    Untracked,
    #[serde(rename = "conflict")]
    Conflict,
}
impl ::std::fmt::Display
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemKind
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
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemKind
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
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemKind
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemKind
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemKind
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemOriginalPath`
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemOriginalPath(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemOriginalPath
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemOriginalPath,
    > for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemOriginalPath,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemOriginalPath
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
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemOriginalPath
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemOriginalPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemOriginalPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemOriginalPath
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
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemPath`
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemPath(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemPath
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemPath>
    for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemPath,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemPath
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
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemPath
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemPath
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
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemWorktree`
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemWorktree(
    ::std::string::String,
);
impl ::std::ops::Deref
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemWorktree
{
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl
    ::std::convert::From<
        ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemWorktree,
    > for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemWorktree,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemWorktree
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
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemWorktree
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemWorktree
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemWorktree
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusFilesItemWorktree
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
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusGitWorkspacesItem`
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusGitWorkspacesItem {
    pub branch: ::std::option::Option<::std::string::String>,
    pub path: ::std::string::String,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusOperation`
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
pub enum ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusOperation {
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
impl ::std::fmt::Display for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusOperation {
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
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusOperation {
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
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusOperation
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusOperation
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueStatusOperation
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspace`
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspace {
    pub branch: ::std::option::Option<::std::string::String>,
    pub id: ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceId,
    #[serde(rename = "localPath")]
    pub local_path: ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceLocalPath,
    pub name: ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceName,
    pub slug: ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceSlug,
}
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceId`
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceId(::std::string::String);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceId>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceId
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceId
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceId
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
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceLocalPath`
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceLocalPath(
    ::std::string::String,
);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceLocalPath {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceLocalPath>
    for ::std::string::String
{
    fn from(
        value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceLocalPath,
    ) -> Self {
        value.0
    }
}
impl ::std::str::FromStr
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceLocalPath
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
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceLocalPath
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceLocalPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceLocalPath
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceLocalPath
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
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceName`
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceName(
    ::std::string::String,
);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceName {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceName>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceName) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceName {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceName
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceName
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceName
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
///`ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceSlug`
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
pub struct ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceSlug(
    ::std::string::String,
);
impl ::std::ops::Deref for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceSlug {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceSlug>
    for ::std::string::String
{
    fn from(value: ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceSlug) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceSlug {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceSlug
{
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceSlug
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceSlug
{
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de>
    for ExeoraProtocolTypesExecutorMessageResultVariant0ValueWorkspaceSlug
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
