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
///                  "run_command",
///                  "start_command",
///                  "get_command_output",
///                  "send_command_input",
///                  "kill_command"
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
///              "run_command",
///              "start_command",
///              "get_command_output",
///              "send_command_input",
///              "kill_command"
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
///                          "run_command",
///                          "start_command",
///                          "get_command_output",
///                          "send_command_input",
///                          "kill_command"
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
///                "run_command",
///                "start_command",
///                "get_command_output",
///                "send_command_input",
///                "kill_command"
///              ]
///            },
///            "type": {
///              "type": "string",
///              "const": "tool.call"
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
///                "run_command",
///                "start_command",
///                "get_command_output",
///                "send_command_input",
///                "kill_command"
///              ]
///            },
///            "type": {
///              "type": "string",
///              "const": "approval.request"
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
///              "run_command",
///              "start_command",
///              "get_command_output",
///              "send_command_input",
///              "kill_command"
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
///    "run_command",
///    "start_command",
///    "get_command_output",
///    "send_command_input",
///    "kill_command"
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
}
impl ::std::fmt::Display for ExeoraProtocolTypesCommandPolicyToolsItem {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::ReadFile => f.write_str("read_file"),
            Self::ListFiles => f.write_str("list_files"),
            Self::Grep => f.write_str("grep"),
            Self::EditFile => f.write_str("edit_file"),
            Self::WriteFile => f.write_str("write_file"),
            Self::RunCommand => f.write_str("run_command"),
            Self::StartCommand => f.write_str("start_command"),
            Self::GetCommandOutput => f.write_str("get_command_output"),
            Self::SendCommandInput => f.write_str("send_command_input"),
            Self::KillCommand => f.write_str("kill_command"),
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
            "run_command" => Ok(Self::RunCommand),
            "start_command" => Ok(Self::StartCommand),
            "get_command_output" => Ok(Self::GetCommandOutput),
            "send_command_input" => Ok(Self::SendCommandInput),
            "kill_command" => Ok(Self::KillCommand),
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
    #[serde(rename = "approval.answer")]
    ApprovalAnswer {
        approved: bool,
        id: ::std::string::String,
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
///    }
///  },
///  "additionalProperties": false
///}
/// ```
/// </details>
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ExeoraProtocolTypesExecutorMessageCapabilities {
    pub prompt: bool,
    pub tools: ::std::vec::Vec<ExeoraProtocolTypesExecutorMessageCapabilitiesToolsItem>,
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
///          "run_command",
///          "start_command",
///          "get_command_output",
///          "send_command_input",
///          "kill_command"
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
///    "run_command",
///    "start_command",
///    "get_command_output",
///    "send_command_input",
///    "kill_command"
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
}
impl ::std::fmt::Display for ExeoraProtocolTypesLocalCommandPolicyToolsItem {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::ReadFile => f.write_str("read_file"),
            Self::ListFiles => f.write_str("list_files"),
            Self::Grep => f.write_str("grep"),
            Self::EditFile => f.write_str("edit_file"),
            Self::WriteFile => f.write_str("write_file"),
            Self::RunCommand => f.write_str("run_command"),
            Self::StartCommand => f.write_str("start_command"),
            Self::GetCommandOutput => f.write_str("get_command_output"),
            Self::SendCommandInput => f.write_str("send_command_input"),
            Self::KillCommand => f.write_str("kill_command"),
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
            "run_command" => Ok(Self::RunCommand),
            "start_command" => Ok(Self::StartCommand),
            "get_command_output" => Ok(Self::GetCommandOutput),
            "send_command_input" => Ok(Self::SendCommandInput),
            "kill_command" => Ok(Self::KillCommand),
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
///                      "run_command",
///                      "start_command",
///                      "get_command_output",
///                      "send_command_input",
///                      "kill_command"
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
///            "run_command",
///            "start_command",
///            "get_command_output",
///            "send_command_input",
///            "kill_command"
///          ]
///        },
///        "type": {
///          "type": "string",
///          "const": "tool.call"
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
///            "run_command",
///            "start_command",
///            "get_command_output",
///            "send_command_input",
///            "kill_command"
///          ]
///        },
///        "type": {
///          "type": "string",
///          "const": "approval.request"
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
    },
    #[serde(rename = "approval.resolved")]
    ApprovalResolved { id: ::std::string::String },
}
///`ExeoraProtocolTypesRelayMessageClient`
///
/// <details><summary>JSON schema</summary>
///
/// ```json
///{
///  "type": "object",
///  "properties": {
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
    pub name: ::std::option::Option<::std::string::String>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub version: ::std::option::Option<::std::string::String>,
}
impl ::std::default::Default for ExeoraProtocolTypesRelayMessageClient {
    fn default() -> Self {
        Self {
            name: Default::default(),
            version: Default::default(),
        }
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
///              "run_command",
///              "start_command",
///              "get_command_output",
///              "send_command_input",
///              "kill_command"
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
///    "run_command",
///    "start_command",
///    "get_command_output",
///    "send_command_input",
///    "kill_command"
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
}
impl ::std::fmt::Display for ExeoraProtocolTypesRelayMessagePolicyToolsItem {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::ReadFile => f.write_str("read_file"),
            Self::ListFiles => f.write_str("list_files"),
            Self::Grep => f.write_str("grep"),
            Self::EditFile => f.write_str("edit_file"),
            Self::WriteFile => f.write_str("write_file"),
            Self::RunCommand => f.write_str("run_command"),
            Self::StartCommand => f.write_str("start_command"),
            Self::GetCommandOutput => f.write_str("get_command_output"),
            Self::SendCommandInput => f.write_str("send_command_input"),
            Self::KillCommand => f.write_str("kill_command"),
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
            "run_command" => Ok(Self::RunCommand),
            "start_command" => Ok(Self::StartCommand),
            "get_command_output" => Ok(Self::GetCommandOutput),
            "send_command_input" => Ok(Self::SendCommandInput),
            "kill_command" => Ok(Self::KillCommand),
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
///    "run_command",
///    "start_command",
///    "get_command_output",
///    "send_command_input",
///    "kill_command"
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
}
impl ::std::fmt::Display for ExeoraProtocolTypesRelayMessageTool {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::ReadFile => f.write_str("read_file"),
            Self::ListFiles => f.write_str("list_files"),
            Self::Grep => f.write_str("grep"),
            Self::EditFile => f.write_str("edit_file"),
            Self::WriteFile => f.write_str("write_file"),
            Self::RunCommand => f.write_str("run_command"),
            Self::StartCommand => f.write_str("start_command"),
            Self::GetCommandOutput => f.write_str("get_command_output"),
            Self::SendCommandInput => f.write_str("send_command_input"),
            Self::KillCommand => f.write_str("kill_command"),
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
            "run_command" => Ok(Self::RunCommand),
            "start_command" => Ok(Self::StartCommand),
            "get_command_output" => Ok(Self::GetCommandOutput),
            "send_command_input" => Ok(Self::SendCommandInput),
            "kill_command" => Ok(Self::KillCommand),
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
