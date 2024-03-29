import express from 'express';
import { Op } from 'sequelize';
import DocumentPermission from '../../models/DocumentPermissions';
import Document from '../../models/Documents';
import User from '../../models/User';
import { validateAdmin, validateUser } from '../middleware/validateUser';
import { ErrorHandler, ResponseHandler } from '../utils/handlers';
import { deleteS3Object, getRandomString } from '../fileupload/upload';
import { Notification } from '../notification/Notification';
import NotificationTemplate from '../../models/NotificationTemplate';
import RecentActivities from '../../models/RecentActivities';
const router: express.Router = express.Router();
router.get('/list_doc_box/:parent_document_id', validateUser, async (req, res) => {
  const user = (req as any).user;
  const { parent_document_id } = req.params as any;
  let documents = [];
  if (user.user_role_id == 1) {
    documents = await Document.findAll({
      where: {
        ...(Number(parent_document_id) != 0
          ? {
              parent_document: Number(parent_document_id),
            }
          : {}),
        is_doc_box: true,
      },
      include: [{ model: DocumentPermission, include: [{ model: User, attributes: { exclude: ['password'] } }] }],
    });
  } else {
    const permissions = await DocumentPermission.findAll({
      where: {
        user_id: user?.user_id,
      },
    });
    documents = await Document.findAll({
      where: {
        is_doc_box: true,
        document_id: { [Op.in]: permissions?.map((s) => s.document_id) },
      },
      raw: true,
    });
  }
  res.json(documents);
});
router.post('/create_doc_box', validateAdmin, async (req, res) => {
  const user = (req as any).user;
  const { user_ids } = (req as any).body;
  const last_document = await Document.findOne({
    where: {
      is_doc_box: true,
    },
    order: [['document_id', 'DESC']],
    limit: 1,
  });
  const created_document = await Document.create({
    name: `DocBox-${String((last_document?.document_id || 0) + 1).padStart(5, '0')}`,
    is_doc_box: true,
    doc_box_id: getRandomString(16),
  });
  for (const user_id of user_ids) {
    await DocumentPermission.create({
      document_id: created_document.document_id,
      user_id,
    });
    await RecentActivities.create({
      activity_title: `Admin created ${created_document?.name} docbox and assigned to you`,
      for_client: true,
      user_id,
    });
    const dbUser = await User.findByPk(user_id);
    const template = await NotificationTemplate.findOne({
      where: {
        name: 'ADD_DOC_BOX',
      },
    });
    try {
      Notification.sendNotification(dbUser, template, {
        doc_box_name: created_document?.name,
        docbox_id: created_document?.doc_box_id,
      }).catch((e) => {
        console.log('erorr on sending mail', e);
      });
    } catch (e) {
      console.log('erorr on sending mail', e);
    }
  }
  await RecentActivities.create({
    activity_title: `You created ${created_document?.name} docbox`,
    for_admin: true,
    user_id: user?.user_id,
  });
  ResponseHandler.response(res, 200, 'success', created_document);
});

router.post('/update_doc_box', validateAdmin, async (req, res) => {
  const { user_ids, document_id } = (req as any).body;
  await DocumentPermission.destroy({
    where: {
      document_id,
    },
  });
  for (const user_id of user_ids) {
    await DocumentPermission.create({
      document_id: document_id,
      user_id,
    });
  }
  res.json('Updated');
});

router.delete('/delete_doc_box/:document_id', validateAdmin, async (req, res) => {
  const { document_id } = req.params as any;
  const user = (req as any).user;
  const documents = await DocumentPermission.findAll({
    where: {
      document_id,
    },
  });
  const document = await Document.findByPk(document_id);
  await DocumentPermission.destroy({
    where: {
      document_id,
    },
  });
  await Document.destroy({
    where: {
      document_id,
    },
  });
  for (const doc of documents) {
    await RecentActivities.create({
      activity_title: `${document.name} docbox has been deleted by Admin`,
      for_client: true,
      user_id: doc?.user_id,
    });
  }
  await RecentActivities.create({
    activity_title: `You deleted ${document.name} docbox`,
    for_admin: true,
    user_id: user?.user_id,
  });
  res.json('Deleted');
});

router.post('/upload_documents', validateUser, async (req, res) => {
  const user = (req as any).user;
  const { files } = (req as any).body;
  for (const file of files) {
    const created_document = await Document.create({
      ...file,
      uploaded_by: user?.user_id,
    });
    const docbox = await Document.findOne({ where: { doc_box_id: file.parent_document } });
    await RecentActivities.create({
      activity_title: `You uploaded a document under ${docbox?.name}`,
      for_client: user?.user_role_id != 1,
      for_admin: user?.user_role_id == 1,
      user_id: user?.user_id,
    });
    if (user?.user_role_id != 1) {
      const template = await NotificationTemplate.findOne({
        where: {
          name: 'UPLOAD_DOCUMENT',
        },
      });

      if (docbox) {
        try {
          Notification.sendNotification(user, template, {
            doc_box_name: docbox?.name,
            docbox_id: docbox?.doc_box_id,
          }).catch((e) => {
            console.log('erorr on sending mail', e);
          });
        } catch (e) {
          console.log('error on sending mail', e);
        }
      }
    }
  }
  res.json('Document created');
});

router.get('/list_documents/:docbox_id', validateUser, async (req, res) => {
  const user = (req as any).user;
  const { docbox_id } = req.params as any;
  let documents = [];
  if (user?.user_role_id == 1) {
    documents = await Document.findAll({
      where: {
        parent_document: docbox_id,
      },
      include: [{ model: DocumentPermission, include: [{ model: User, attributes: { exclude: ['password'] } }] }],
    });
  } else {
    documents = await Document.findAll({
      where: {
        parent_document: docbox_id,
        uploaded_by: user?.user_id,
      },
    });
  }
  res.json(documents);
});

router.delete('/delete_document/:document_id', validateUser, async (req, res) => {
  const user = (req as any).user;
  const { document_id } = req.params as any;
  const document = await Document.findByPk(document_id);
  if (user?.user_role_id != 1 && document?.uploaded_by != user?.user_id) {
    return ErrorHandler.response(res, 400, `You don't have access to delete this document`, {});
  }
  let key = document.s3_url?.split('amazonaws.com')[0];
  await deleteS3Object(document.s3_url?.split('amazonaws.com')[0]);
  const docbox = await Document.findOne({ where: { doc_box_id: document.parent_document } });
  await RecentActivities.create({
    activity_title: `You deleted a document from ${docbox?.name}`,
    for_client: user?.user_role_id != 1,
    for_admin: user?.user_role_id == 1,
    user_id: user?.user_id,
  });
  await Document.destroy({
    where: {
      document_id,
    },
  });
  res.json('Docuemnt deleted');
});

module.exports = router;
